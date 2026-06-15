import { describe, it, expect } from 'vitest';
import { NAV, buildAdminNav, type NavItem } from '@/lib/admin/nav';
import {
  buildPermissionSet,
  type AuthUser,
} from '@/lib/auth/rbac';
import { SYSTEM_ROLES } from '@/lib/auth/permissions';

/**
 * Юнит-тесты чистой логики состава меню (docs/04 §6.3).
 * Всё детерминировано: env передаётся явно, без обращения к process.env.
 */

/** Находит определение системной роли по коду. */
function role(code: 'owner' | 'admin' | 'manager') {
  const def = SYSTEM_ROLES.find((r) => r.code === code);
  if (!def) throw new Error(`Роль ${code} не найдена в SYSTEM_ROLES`);
  return def;
}

/** Конструирует тестового пользователя из набора системных ролей. */
function makeUser(opts: {
  isOwner?: boolean;
  roles?: ('owner' | 'admin' | 'manager')[];
}): AuthUser {
  return {
    id: 'u1',
    email: 'test@example.com',
    isOwner: opts.isOwner ?? false,
    permissions: buildPermissionSet((opts.roles ?? []).map(role)),
  };
}

/** Метки пунктов меню по результату фильтрации. */
function labels(items: NavItem[]): string[] {
  return items.map((i) => i.label);
}

describe('admin/nav — buildAdminNav', () => {
  it('owner видит все пункты при всех включённых модулях', () => {
    const owner = makeUser({ isOwner: true });
    // Пустой env → isModuleEnabled включает все модули по умолчанию.
    const result = buildAdminNav(owner, {});
    expect(result).toHaveLength(NAV.length);
    expect(labels(result)).toEqual(labels([...NAV]));
  });

  it('при ADMIK_MODULES без catalog пункт «Каталог» скрыт даже у owner', () => {
    const owner = makeUser({ isOwner: true });
    const result = buildAdminNav(owner, {
      ADMIK_MODULES: 'orders,cdek,cms',
    });
    expect(labels(result)).not.toContain('Каталог');
    // Остальные модульные пункты остаются у владельца.
    expect(labels(result)).toContain('Заказы');
    expect(labels(result)).toContain('Доставка');
    expect(labels(result)).toContain('Контент');
  });

  it('пользователь без права audit.read не видит «Аудит»', () => {
    // admin имеет audit.read; уберём его, оставив только catalog.read.
    const user = makeUser({});
    user.permissions = buildPermissionSet([
      { permissions: ['catalog.read'] },
    ]);
    const result = buildAdminNav(user, {});
    expect(labels(result)).not.toContain('Аудит');
    expect(labels(result)).toContain('Каталог');
  });

  it('manager видит «Заказы» и «Промокоды», но не видит «Пользователи»', () => {
    const manager = makeUser({ roles: ['manager'] });
    const result = buildAdminNav(manager, {});
    expect(labels(result)).toContain('Заказы');
    // «Промокоды» — пункт модуля orders под правом orders.write (есть у manager).
    expect(labels(result)).toContain('Промокоды');
    expect(labels(result)).not.toContain('Пользователи');
    // manager не имеет roles.manage / users.read → нет Ролей и Пользователей.
    expect(labels(result)).not.toContain('Роли');
  });

  it('при выключенном модуле orders скрыты и «Заказы», и «Промокоды»', () => {
    const owner = makeUser({ isOwner: true });
    const result = buildAdminNav(owner, { ADMIK_MODULES: 'catalog,cdek,cms' });
    expect(labels(result)).not.toContain('Заказы');
    expect(labels(result)).not.toContain('Промокоды');
    expect(labels(result)).toContain('Каталог');
  });

  it('пользователь только с orders.read видит «Заказы», но не «Промокоды»', () => {
    // «Промокоды» требует orders.write — read-only пользователь его не видит.
    const user = makeUser({});
    user.permissions = buildPermissionSet([{ permissions: ['orders.read'] }]);
    const result = buildAdminNav(user, {});
    expect(labels(result)).toContain('Заказы');
    expect(labels(result)).not.toContain('Промокоды');
  });

  it('«Дашборд» виден всегда (нет требований по модулю/праву)', () => {
    // Пользователь без прав и без включённых модулей.
    const nobody = makeUser({});
    const noModules = buildAdminNav(nobody, { ADMIK_MODULES: 'none' });
    expect(labels(noModules)).toContain('Дашборд');

    // И у владельца тоже присутствует.
    const owner = makeUser({ isOwner: true });
    expect(labels(buildAdminNav(owner, {}))).toContain('Дашборд');
  });
});
