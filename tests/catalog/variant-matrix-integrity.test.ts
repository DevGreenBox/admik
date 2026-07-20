import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/lib/auth/rbac';
import type { PermissionCode } from '@/lib/auth/permissions';

/**
 * ЮНИТ-тесты целостности данных `applyVariantMatrix` (ревью спринта B, M1/M2/L1).
 * Харнесс — копия variant-matrix-action.test.ts + отметка «вызов внутри
 * транзакции» (нужна, чтобы доказать: справочник добирается ДО sql.begin).
 *
 * Что защищается:
 *  M1. Клиент присылает ТОЛЬКО id значений справочника. Подписи цветов берутся
 *      из attribute_values СЕРВЕРОМ, по attribute_id справочника «Цвет»;
 *      чужой valueId (значение другого словаря) — отказ, а не строка в EAV.
 *      Явный colorAttributeId проверяется как ЦВЕТОВОЙ справочник.
 *  M2. База артикула уникальна ПО ТОВАРУ (префикс slug товара), кандидаты со
 *      случайным хвостом, и исчерпание попыток на ОДНОЙ ячейке не откатывает
 *      всю матрицу.
 *  L1. В audit_log.after уходят счётчики и выборка первых значений, а не
 *      полные массивы цветов/размеров.
 */

const H = vi.hoisted(() => {
  interface SqlCall {
    text: string;
    args: unknown[];
    /** true, если запрос выполнен внутри колбэка sql.begin. */
    inTx: boolean;
  }
  interface QueuedResult {
    match: string;
    rows?: unknown[];
    times?: number;
    /** Доп. условие по интерполированным аргументам (напр. по кандидату sku). */
    where?: (args: unknown[]) => boolean;
  }
  const state = {
    currentUser: null as AuthUser | null,
    sqlCalls: [] as SqlCall[],
    sqlResponses: [] as QueuedResult[],
    beginCalls: 0,
    inTx: false,
  };

  const sqlMock = vi.fn((strings: TemplateStringsArray, ...args: unknown[]) => {
    const text = Array.from(strings).join('?');
    state.sqlCalls.push({ text, args, inTx: state.inTx });
    for (const r of state.sqlResponses) {
      if (text.includes(r.match) && (r.where === undefined || r.where(args))) {
        if (typeof r.times === 'number') {
          if (r.times <= 0) continue;
          r.times -= 1;
        }
        return Promise.resolve(r.rows ?? []);
      }
    }
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
    revalidateSpy: vi.fn((..._args: unknown[]) => {}),
    rebuildVariantCacheSpy: vi.fn(async (..._args: unknown[]) => {}),
    getCurrentUserMock: vi.fn(async () => state.currentUser),
  };
});

const { sqlMock } = H;

vi.mock('@/lib/auth/session', () => ({ getCurrentUser: H.getCurrentUserMock }));
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => H.revalidateSpy(...(args as [])),
}));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }));
vi.mock('@/lib/audit/log', () => ({
  writeAudit: (...args: unknown[]) => H.writeAuditSpy(...(args as [])),
}));
vi.mock('@/lib/config/settings', () => ({
  isModuleEffectivelyEnabled: async () => true,
}));
vi.mock('@/lib/db/client', () => ({ sql: H.sqlMock }));
vi.mock('@/lib/catalog/cache', () => ({
  rebuildProductAttributesCache: async () => ({}),
  rebuildVariantAttributesCache: (...args: unknown[]) =>
    H.rebuildVariantCacheSpy(...(args as [])),
}));

// Импорт action ПОСЛЕ моков.
import { applyVariantMatrix } from '@/lib/catalog/actions';

function makeOwner(): AuthUser {
  return {
    id: 'u-1',
    email: 'owner@shop.io',
    isOwner: true,
    permissions: new Set<PermissionCode>(),
  };
}

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const PRODUCT_SLUG = 'palto-oversize';
const COLOR_ATTR = '99999999-9999-4999-8999-999999999999';
const SIZE_ATTR = '88888888-8888-4888-8888-888888888888';
const WHITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BLACK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** Значение ЧУЖОГО словаря («Размер» → «42»), которое клиент выдаёт за цвет. */
const ALIEN_SIZE_VALUE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function findCalls(match: string) {
  return H.state.sqlCalls.filter((c) => c.text.includes(match));
}

/** Товар существует и имеет slug — из него строится префикс артикула (M2). */
function queueProduct(slug = PRODUCT_SLUG) {
  H.state.sqlResponses.push({
    match: 'FROM products',
    rows: [{ id: PRODUCT, slug }],
  });
}

/** Справочник «Цвет» по явному id: имя распознаётся isColorAttribute. */
function queueColorAttribute(
  row: { id: string; code: string; name: string } = {
    id: COLOR_ATTR,
    code: 'color',
    name: 'Цвет',
  },
) {
  H.state.sqlResponses.push({ match: 'FROM attributes', rows: [row] });
}

/** Значения словаря «Цвет», которые сервер реально нашёл. */
function queueColorValues(rows: { id: string; value: string }[]) {
  H.state.sqlResponses.push({ match: 'FROM attribute_values', rows });
}

/** Ответ на INSERT варианта: разный id на каждый вызов. */
function queueVariantInserts(ids: string[]) {
  for (const id of ids) {
    H.state.sqlResponses.push({
      match: 'INSERT INTO product_variants',
      rows: [{ id }],
      times: 1,
    });
  }
}

function auditAfter(): Record<string, unknown> {
  const entry = H.writeAuditSpy.mock.calls[0]![0] as {
    after?: Record<string, unknown>;
  };
  return entry.after ?? {};
}

beforeEach(() => {
  H.state.currentUser = makeOwner();
  H.state.sqlCalls = [];
  H.state.sqlResponses = [];
  H.state.beginCalls = 0;
  H.state.inTx = false;
  sqlMock.mockClear();
  H.writeAuditSpy.mockClear();
  H.revalidateSpy.mockClear();
  H.rebuildVariantCacheSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// M1 — сервер не доверяет клиентским valueId/подписям цвета.
// =============================================================================

describe('M1 — значения цвета добираются из справочника сервером', () => {
  it('чужой valueId (значение словаря «Размер») отбраковывается, ни одной вставки', async () => {
    queueProduct();
    queueColorAttribute();
    // Сервер спрашивает словарь ЦВЕТА — чужого значения там нет.
    queueColorValues([{ id: WHITE_ID, value: 'Белый' }]);

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: COLOR_ATTR,
      colors: [WHITE_ID, ALIEN_SIZE_VALUE_ID],
      sizes: ['42'],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('validation');
      expect(res.message ?? '').toMatch(/цвет/i);
    }
    expect(findCalls('INSERT INTO product_variants')).toHaveLength(0);
    expect(findCalls('INSERT INTO product_attributes')).toHaveLength(0);
    expect(H.state.beginCalls).toBe(0);
  });

  it('запрос словаря идёт ДО транзакции и скоупится attribute_id справочника', async () => {
    queueProduct();
    queueColorAttribute();
    queueColorValues([{ id: WHITE_ID, value: 'Белый' }]);
    queueVariantInserts(['v1']);

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: COLOR_ATTR,
      colors: [WHITE_ID],
      sizes: ['42'],
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);

    const lookup = findCalls('FROM attribute_values');
    expect(lookup).toHaveLength(1);
    expect(lookup[0]!.inTx).toBe(false);
    expect(lookup[0]!.text).toContain('attribute_id =');
    // Аргументы: массив запрошенных id + id справочника «Цвет».
    expect(lookup[0]!.args).toEqual([[WHITE_ID], COLOR_ATTR]);
  });

  it('подпись цвета для sku и аудита берётся из БД, а не от клиента', async () => {
    queueProduct();
    queueColorAttribute();
    // В БД цвет называется «Белый» — именно он должен попасть в sku и аудит.
    queueColorValues([{ id: WHITE_ID, value: 'Белый' }]);
    queueVariantInserts(['v1']);

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: COLOR_ATTR,
      colors: [WHITE_ID],
      sizes: ['42'],
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);

    const sku = String(findCalls('INSERT INTO product_variants')[0]!.args[1]);
    expect(sku).toContain('belyy');

    expect(auditAfter().colors).toEqual(['Белый']);
  });

  it('в EAV пишется только id из справочника, привязка скоупится attribute_id цвета', async () => {
    queueProduct();
    queueColorAttribute();
    queueColorValues([
      { id: WHITE_ID, value: 'Белый' },
      { id: BLACK_ID, value: 'Чёрный' },
    ]);
    queueVariantInserts(['v1', 'v2']);

    await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: COLOR_ATTR,
      colors: [WHITE_ID, BLACK_ID],
      sizes: ['42'],
    });

    const eav = findCalls('INSERT INTO product_attributes');
    expect(eav).toHaveLength(2);
    expect(eav[0]!.args).toEqual([PRODUCT, 'v1', COLOR_ATTR, WHITE_ID]);
    expect(eav[1]!.args).toEqual([PRODUCT, 'v2', COLOR_ATTR, BLACK_ID]);
  });

  it('явный colorAttributeId, указывающий НЕ на справочник «Цвет», отклоняется', async () => {
    queueProduct();
    // Клиент подсунул id словаря «Размер».
    queueColorAttribute({ id: SIZE_ATTR, code: 'size', name: 'Размер' });

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: SIZE_ATTR,
      colors: [WHITE_ID],
      sizes: ['42'],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('validation');
      expect(res.message ?? '').toMatch(/цвет/i);
    }
    expect(findCalls('INSERT INTO product_variants')).toHaveLength(0);
    expect(H.state.beginCalls).toBe(0);
  });

  it('несуществующий colorAttributeId отклоняется (а не молча становится справочником)', async () => {
    queueProduct();
    H.state.sqlResponses.push({ match: 'FROM attributes', rows: [] });

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: SIZE_ATTR,
      colors: [WHITE_ID],
      sizes: ['42'],
    });

    expect(res.ok).toBe(false);
    expect(findCalls('INSERT INTO product_variants')).toHaveLength(0);
  });

  it('без явного id справочник ищется по имени/коду, значения — всё равно из БД', async () => {
    queueProduct();
    H.state.sqlResponses.push({
      match: 'FROM attributes',
      rows: [{ id: COLOR_ATTR, code: 'demo-color', name: 'Цвет' }],
    });
    queueColorValues([{ id: BLACK_ID, value: 'Чёрный' }]);
    queueVariantInserts(['v1']);

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colors: [BLACK_ID],
      sizes: ['44'],
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(auditAfter().colors).toEqual(['Чёрный']);
  });

  it('несуществующий товар → not_found до любой записи', async () => {
    H.state.sqlResponses.push({ match: 'FROM products', rows: [] });

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colors: [],
      sizes: ['42'],
    });

    expect(res.ok).toBe(false);
    expect(findCalls('INSERT INTO product_variants')).toHaveLength(0);
    expect(H.state.beginCalls).toBe(0);
  });
});

// =============================================================================
// M2 — артикул уникален по товару; исчерпание попыток не рушит матрицу.
// =============================================================================

describe('M2 — подбор артикула', () => {
  it('база артикула включает slug товара (пара «цвет × размер» не глобальна)', async () => {
    queueProduct();
    queueColorAttribute();
    queueColorValues([{ id: WHITE_ID, value: 'Белый' }]);
    queueVariantInserts(['v1']);

    await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: COLOR_ATTR,
      colors: [WHITE_ID],
      sizes: ['42'],
    });

    const sku = String(findCalls('INSERT INTO product_variants')[0]!.args[1]);
    expect(sku.startsWith(`${PRODUCT_SLUG}-`)).toBe(true);
    expect(sku).toBe(`${PRODUCT_SLUG}-belyy-42`);
  });

  it('кандидаты не повторяются и с 3-й попытки получают случайный хвост', async () => {
    queueProduct();
    queueColorAttribute();
    queueColorValues([{ id: WHITE_ID, value: 'Белый' }]);
    // Все кандидаты заняты — смотрим, какие sku перебирались.
    H.state.sqlResponses.push({
      match: 'INSERT INTO product_variants',
      rows: [],
    });

    await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: COLOR_ATTR,
      colors: [WHITE_ID],
      sizes: ['42'],
    });

    const skus = findCalls('INSERT INTO product_variants').map((c) =>
      String(c.args[1]),
    );
    // Потолок поднят выше прежних 8 попыток.
    expect(skus.length).toBeGreaterThan(8);
    // Кандидаты уникальны (иначе ретрай бессмысленен).
    expect(new Set(skus).size).toBe(skus.length);
    // Хвост не сводится к последовательному счётчику -2/-3/...
    const numbered = skus.filter((s) => /-\d+$/.test(s)).length;
    expect(numbered).toBeLessThan(skus.length);
  });

  it('исчерпание попыток на одной ячейке НЕ откатывает остальные', async () => {
    queueProduct();
    queueColorAttribute();
    queueColorValues([
      { id: WHITE_ID, value: 'Белый' },
      { id: BLACK_ID, value: 'Чёрный' },
    ]);
    // Ячейка «Белый × 42»: занят ЛЮБОЙ её кандидат, сколько бы их ни было.
    H.state.sqlResponses.push({
      match: 'INSERT INTO product_variants',
      where: (args) => String(args[1]).includes('belyy'),
      rows: [],
    });
    // Вторая ячейка вставляется с первой попытки.
    queueVariantInserts(['v2']);

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: COLOR_ATTR,
      colors: [WHITE_ID, BLACK_ID],
      sizes: ['42'],
    });

    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (res.ok) {
      expect(res.data.created).toBe(1);
      expect(res.data.skipped).toBe(1);
    }
    // Транзакция закоммичена (одна на всю матрицу), кеш пересобран для v2.
    expect(H.state.beginCalls).toBe(1);
    expect(H.rebuildVariantCacheSpy.mock.calls[0]![1]).toEqual(['v2']);
    expect(auditAfter().skipped).toBe(1);
  });
});

// =============================================================================
// L1 — аудит не раздувается полными массивами.
// =============================================================================

describe('L1 — компактная запись аудита', () => {
  const MANY_COLORS = Array.from(
    { length: 12 },
    (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
  );

  it('в after пишутся счётчики и не более 10 значений каждой оси', async () => {
    queueProduct();
    queueColorAttribute();
    queueColorValues(
      MANY_COLORS.map((id, i) => ({ id, value: `Цвет ${i}`.padEnd(200, 'ы') })),
    );
    H.state.sqlResponses.push({
      match: 'INSERT INTO product_variants',
      rows: [{ id: 'v' }],
    });

    const sizes = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: COLOR_ATTR,
      colors: MANY_COLORS,
      sizes,
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);

    const after = auditAfter();
    expect(after.colorsTotal).toBe(12);
    expect(after.sizesTotal).toBe(12);
    expect((after.colors as string[]).length).toBeLessThanOrEqual(10);
    expect((after.sizes as string[]).length).toBeLessThanOrEqual(10);
    // Итоговая запись остаётся компактной (было ≈33 КБ на вызов).
    expect(JSON.stringify(after).length).toBeLessThan(4096);
  });
});
