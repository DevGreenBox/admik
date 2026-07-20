import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/lib/auth/rbac';
import type { PermissionCode } from '@/lib/auth/permissions';

/**
 * ЮНИТ-тест атомарности `setProductAttributes` (ревью спринта B, M3).
 *
 * ПОЧЕМУ: действие выполняет «полную замену» — DELETE привязок уровня товара и
 * переданных вариантов, затем серию INSERT. Без общей транзакции каждый запрос
 * шёл в своей автокоммит-транзакции, и обрыв процесса между DELETE и INSERT
 * оставлял товар БЕЗ характеристик (а варианты — без цвета). С матрицей
 * «цвет × размер» товар с сотнями привязок стал нормой, цена обрыва выросла.
 *
 * Харнесс — как в variant-matrix-action.test.ts, плюс отметка «запрос выполнен
 * внутри колбэка sql.begin» (иначе транзакцию не отличить от автокоммита).
 */

const H = vi.hoisted(() => {
  interface SqlCall {
    text: string;
    args: unknown[];
    inTx: boolean;
  }
  const state = {
    currentUser: null as AuthUser | null,
    sqlCalls: [] as SqlCall[],
    beginCalls: 0,
    inTx: false,
    /** Значение inTx в момент вызова пересбора кеша. */
    cacheInTx: [] as boolean[],
  };

  const sqlMock = vi.fn((strings: TemplateStringsArray, ...args: unknown[]) => {
    state.sqlCalls.push({
      text: Array.from(strings).join('?'),
      args,
      inTx: state.inTx,
    });
    return Promise.resolve([] as unknown[]);
  });
  (sqlMock as unknown as { json: unknown }).json = (v: unknown) => v;
  (sqlMock as unknown as { begin: unknown }).begin = async (
    cb: (tx: unknown) => unknown,
  ) => {
    state.beginCalls += 1;
    state.inTx = true;
    try {
      return await cb(sqlMock);
    } finally {
      state.inTx = false;
    }
  };

  return {
    state,
    sqlMock,
    writeAuditSpy: vi.fn(async (..._args: unknown[]) => {}),
    getCurrentUserMock: vi.fn(async () => state.currentUser),
  };
});

const { sqlMock } = H;

vi.mock('@/lib/auth/session', () => ({ getCurrentUser: H.getCurrentUserMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }));
vi.mock('@/lib/audit/log', () => ({
  writeAudit: (...args: unknown[]) => H.writeAuditSpy(...(args as [])),
}));
vi.mock('@/lib/config/settings', () => ({
  isModuleEffectivelyEnabled: async () => true,
}));
vi.mock('@/lib/db/client', () => ({ sql: H.sqlMock }));
vi.mock('@/lib/catalog/cache', () => ({
  rebuildProductAttributesCache: async () => {
    H.state.cacheInTx.push(H.state.inTx);
    return {};
  },
  rebuildVariantAttributesCache: async () => {
    H.state.cacheInTx.push(H.state.inTx);
  },
}));

// Импорт action ПОСЛЕ моков.
import { setProductAttributes } from '@/lib/catalog/actions';

function makeOwner(): AuthUser {
  return {
    id: 'u-1',
    email: 'owner@shop.io',
    isOwner: true,
    permissions: new Set<PermissionCode>(),
  };
}

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const VAR_A = '22222222-2222-4222-8222-222222222222';
const ATTR = '99999999-9999-4999-8999-999999999999';
const VALUE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function findCalls(match: string) {
  return H.state.sqlCalls.filter((c) => c.text.includes(match));
}

beforeEach(() => {
  H.state.currentUser = makeOwner();
  H.state.sqlCalls = [];
  H.state.beginCalls = 0;
  H.state.inTx = false;
  H.state.cacheInTx = [];
  sqlMock.mockClear();
  H.writeAuditSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('M3 — setProductAttributes атомарен', () => {
  it('DELETE и все INSERT выполняются в ОДНОЙ транзакции', async () => {
    const res = await setProductAttributes({
      productId: PRODUCT,
      items: [
        { attributeId: ATTR, valueText: 'Хлопок' },
        { attributeId: ATTR, variantId: VAR_A, valueId: VALUE },
      ],
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);

    expect(H.state.beginCalls).toBe(1);

    const writes = [
      ...findCalls('DELETE FROM product_attributes'),
      ...findCalls('INSERT INTO product_attributes'),
    ];
    expect(writes.length).toBeGreaterThanOrEqual(3);
    for (const c of writes) {
      expect(c.inTx, `запрос вне транзакции: ${c.text}`).toBe(true);
    }
  });

  it('пустой items тоже атомарен: очистка не может «повиснуть» без замены', async () => {
    const res = await setProductAttributes({ productId: PRODUCT, items: [] });
    expect(res.ok, JSON.stringify(res)).toBe(true);

    expect(H.state.beginCalls).toBe(1);
    const del = findCalls('DELETE FROM product_attributes');
    expect(del).toHaveLength(1);
    expect(del[0]!.inTx).toBe(true);
  });

  it('пересбор презентационного кеша — ВНЕ транзакции (как и раньше)', async () => {
    await setProductAttributes({
      productId: PRODUCT,
      items: [{ attributeId: ATTR, variantId: VAR_A, valueId: VALUE }],
    });

    expect(H.state.cacheInTx.length).toBeGreaterThan(0);
    for (const inTx of H.state.cacheInTx) {
      expect(inTx).toBe(false);
    }
  });
});
