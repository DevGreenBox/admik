import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ЮНИТ-тесты Server Actions управления пользователями (lib/auth/admin-actions).
 *
 * Все серверные зависимости замоканы → тесты НЕ трогают БД/Next/argon2:
 *   - @/lib/db/client      — sql как tagged-template + sql.begin (controlled rows);
 *   - @/lib/auth/password  — hashPassword (без тяжёлой крипты);
 *   - @/lib/auth/session   — getCurrentUser (guard в defineAction) +
 *                            invalidateUserSessions (ротация сессий цели);
 *   - @/lib/audit/log      — writeAudit (no-op);
 *   - next/cache, next/headers — revalidatePath / headers (серверные API).
 *
 * Фокус находок безопасности:
 *   1) resetUserPassword НЕ должен трогать учётку владельца (privilege escalation);
 *   2) resetUserPassword обязан ротировать сессии цели (invalidateUserSessions);
 *   3) updateUser при отключении (status != active) ротирует сессии цели.
 */

// Управляемое состояние моков. vi.hoisted поднимает фабрику вместе с vi.mock,
// поэтому ссылки внутри vi.mock-фабрик валидны (нельзя ссылаться на обычные
// module-level переменные — они ещё не инициализированы на момент хойстинга).
const h = vi.hoisted(() => {
  /** Очередь ответов sql() (FIFO): каждый tagged-template берёт следующий набор строк. */
  const state: { sqlResults: unknown[][]; sqlCalls: Array<{ text: string }> } = {
    sqlResults: [],
    sqlCalls: [],
  };

  function nextRows(): unknown[] {
    return state.sqlResults.length > 0 ? (state.sqlResults.shift() as unknown[]) : [];
  }

  function sqlImpl(strings?: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> {
    if (Array.isArray(strings)) {
      state.sqlCalls.push({ text: strings.join('?') });
    }
    return Promise.resolve(nextRows());
  }

  const sqlMock = Object.assign(sqlImpl, {
    begin: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(sqlMock)),
  });

  return {
    state,
    sqlMock,
    hashPassword: vi.fn(async (plain: string) => `hashed:${plain}`),
    invalidateUserSessions: vi.fn(async (_userId: string) => {}),
    writeAudit: vi.fn(async () => {}),
    currentUser: { value: null as unknown },
  };
});

vi.mock('@/lib/db/client', () => ({ sql: h.sqlMock }));
vi.mock('@/lib/auth/password', () => ({ hashPassword: h.hashPassword }));
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(async () => h.currentUser.value),
  invalidateUserSessions: h.invalidateUserSessions,
}));
vi.mock('@/lib/audit/log', () => ({ writeAudit: h.writeAudit }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: (_k: string) => undefined })),
}));
vi.mock('@/lib/auth/admin-repository', () => ({
  assignUserRoles: vi.fn(async () => {}),
  setRolePermissions: vi.fn(async () => {}),
}));

// Импорт ПОСЛЕ объявления моков.
import { resetUserPassword, updateUser } from '@/lib/auth/admin-actions';
import type { AuthUser } from '@/lib/auth/rbac';
import type { PermissionCode } from '@/lib/auth/permissions';

const TARGET = '11111111-1111-4111-8111-111111111111';
const ACTOR = '99999999-9999-4999-8999-999999999999';

function adminUser(): AuthUser {
  return {
    id: ACTOR,
    email: 'admin@shop.io',
    isOwner: false,
    permissions: new Set<PermissionCode>(['users.manage']),
  };
}

beforeEach(() => {
  h.state.sqlResults = [];
  h.state.sqlCalls.length = 0;
  h.hashPassword.mockClear();
  h.invalidateUserSessions.mockClear();
  h.writeAudit.mockClear();
  h.sqlMock.begin.mockClear();
  h.currentUser.value = adminUser();
});

// =============================================================================
// resetUserPassword — защита владельца + ротация сессий.
// =============================================================================

describe('resetUserPassword — защита владельца (privilege escalation)', () => {
  it('целевой пользователь — владелец → отказ PublicActionError, пароль НЕ меняется', async () => {
    // SELECT is_owner → владелец.
    h.state.sqlResults = [[{ id: TARGET, is_owner: true }]];

    const res = await resetUserPassword({ id: TARGET, password: 'newsecret1' });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
    expect(res.message).toBe('Владельца магазина нельзя изменять или отключать.');

    // UPDATE password_hash НЕ должен был выполниться.
    const ranUpdate = h.state.sqlCalls.some((c) =>
      /UPDATE\s+users\s+SET\s+password_hash/i.test(c.text),
    );
    expect(ranUpdate).toBe(false);
    // Сессии владельца не трогаем.
    expect(h.invalidateUserSessions).not.toHaveBeenCalled();
  });
});

describe('resetUserPassword — ротация сессий цели', () => {
  it('обычный пользователь → пароль обновлён + invalidateUserSessions(targetId)', async () => {
    // (1) SELECT is_owner → не владелец; (2) UPDATE ... RETURNING id → строка.
    h.state.sqlResults = [[{ id: TARGET, is_owner: false }], [{ id: TARGET }]];

    const res = await resetUserPassword({ id: TARGET, password: 'newsecret1' });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('ожидался успех');
    expect(res.data).toEqual({ id: TARGET });

    expect(h.hashPassword).toHaveBeenCalledWith('newsecret1');
    // Ротация сессий ИМЕННО целевого пользователя.
    expect(h.invalidateUserSessions).toHaveBeenCalledTimes(1);
    expect(h.invalidateUserSessions).toHaveBeenCalledWith(TARGET);
  });

  it('пользователь не найден → "Пользователь не найден.", сессии не трогаем', async () => {
    // (1) SELECT is_owner → не владелец; (2) UPDATE RETURNING → пусто.
    h.state.sqlResults = [[{ id: TARGET, is_owner: false }], []];

    const res = await resetUserPassword({ id: TARGET, password: 'newsecret1' });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.message).toBe('Пользователь не найден.');
    expect(h.invalidateUserSessions).not.toHaveBeenCalled();
  });
});

// =============================================================================
// updateUser — защита владельца + ротация при отключении.
// =============================================================================

describe('updateUser — защита владельца и ротация при отключении', () => {
  it('целевой пользователь — владелец → отказ PublicActionError', async () => {
    // assertNotOwner делает первый SELECT и сразу бросает на is_owner=true.
    h.state.sqlResults = [[{ id: TARGET, is_owner: true }]];

    const res = await updateUser({ id: TARGET, displayName: 'Hacked' });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.message).toBe('Владельца магазина нельзя изменять или отключать.');
    expect(h.invalidateUserSessions).not.toHaveBeenCalled();
  });

  it('отключение пользователя (status=disabled) → invalidateUserSessions(targetId)', async () => {
    // updateUser делает 2 SELECT: assertNotOwner(id), затем before-снимок.
    h.state.sqlResults = [
      [{ id: TARGET, is_owner: false }],
      [{ id: TARGET, email: 'u@shop.io', display_name: 'U', status: 'active', is_owner: false }],
    ];

    const res = await updateUser({ id: TARGET, status: 'disabled' });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('ожидался успех');
    expect(h.invalidateUserSessions).toHaveBeenCalledTimes(1);
    expect(h.invalidateUserSessions).toHaveBeenCalledWith(TARGET);
  });

  it('обновление без отключения (только displayName) → сессии НЕ ротируем', async () => {
    h.state.sqlResults = [
      [{ id: TARGET, is_owner: false }],
      [{ id: TARGET, email: 'u@shop.io', display_name: 'U', status: 'active', is_owner: false }],
    ];

    const res = await updateUser({ id: TARGET, displayName: 'Новое имя' });

    expect(res.ok).toBe(true);
    expect(h.invalidateUserSessions).not.toHaveBeenCalled();
  });
});
