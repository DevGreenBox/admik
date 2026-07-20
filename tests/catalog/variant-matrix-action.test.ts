import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/lib/auth/rbac';
import type { PermissionCode } from '@/lib/auth/permissions';

/**
 * ЮНИТ-тесты Server Action `applyVariantMatrix` (спринт B) — поведение реального
 * хендлера БЕЗ БД/Next. Харнесс скопирован с variant-attribute-mutations.test.ts:
 * `sql` — tagged-template-спай, `sql.begin(cb)` → cb(спай), auth/cache/audit/
 * settings замоканы.
 *
 * Что здесь защищается (мины карты кода):
 *  (в) матрица N×M — ОДНА транзакция, ОДИН аудит, ОДНА ревалидация, а не N*M
 *      вызовов createVariant;
 *  (а) действие НЕ вызывает setProductAttributes и не удаляет привязки уровня
 *      товара (variant_id IS NULL) — иначе матрица молча стирала бы
 *      характеристики товара;
 *  (б) sku глобально уникален — подбирается ретраем ON CONFLICT DO NOTHING,
 *      а не выдумывается;
 *  (5) в name варианта пишется РАЗМЕР, цвет уходит в вариантный EAV.
 *
 * ВХОД: `colors` — список attribute_values.id. Подписи цветов действие добирает
 * из справочника само, поэтому харнесс обязан отвечать на запросы товара
 * (SELECT slug FROM products), справочника (FROM attributes) и словаря
 * (FROM attribute_values) — см. queueMatrixContext. Целостность этих проверок
 * покрыта отдельно: tests/catalog/variant-matrix-integrity.test.ts.
 */

const H = vi.hoisted(() => {
  interface SqlCall {
    text: string;
    args: unknown[];
  }
  interface QueuedResult {
    match: string;
    rows?: unknown[];
    times?: number;
  }
  const state = {
    currentUser: null as AuthUser | null,
    sqlCalls: [] as SqlCall[],
    sqlResponses: [] as QueuedResult[],
    beginCalls: 0,
  };

  const sqlMock = vi.fn((strings: TemplateStringsArray, ...args: unknown[]) => {
    const text = Array.from(strings).join('?');
    state.sqlCalls.push({ text, args });
    for (const r of state.sqlResponses) {
      if (text.includes(r.match)) {
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
    return cb(sqlMock);
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
const COLOR_ATTR = '99999999-9999-4999-8999-999999999999';
const WHITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BLACK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VAR_A = '22222222-2222-4222-8222-222222222222';

function findCalls(match: string) {
  return H.state.sqlCalls.filter((c) => c.text.includes(match));
}

const PRODUCT_SLUG = 'palto-oversize';

/**
 * Контекст, который действие читает ДО транзакции: товар (его slug — префикс
 * артикула), справочник «Цвет» и подписи выбранных значений словаря.
 */
function queueMatrixContext(
  colorValues: { id: string; value: string }[] = [
    { id: WHITE_ID, value: 'Белый' },
    { id: BLACK_ID, value: 'Чёрный' },
  ],
) {
  H.state.sqlResponses.push({
    match: 'FROM products',
    rows: [{ slug: PRODUCT_SLUG }],
  });
  H.state.sqlResponses.push({
    match: 'FROM attributes',
    rows: [{ id: COLOR_ATTR, code: 'color', name: 'Цвет' }],
  });
  H.state.sqlResponses.push({ match: 'FROM attribute_values', rows: colorValues });
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

beforeEach(() => {
  H.state.currentUser = makeOwner();
  H.state.sqlCalls = [];
  H.state.sqlResponses = [];
  H.state.beginCalls = 0;
  sqlMock.mockClear();
  H.writeAuditSpy.mockClear();
  H.revalidateSpy.mockClear();
  H.rebuildVariantCacheSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('applyVariantMatrix — матрица 2×2 на пустом товаре', () => {
  const input = {
    productId: PRODUCT,
    colorAttributeId: COLOR_ATTR,
    colors: [WHITE_ID, BLACK_ID],
    sizes: ['42', '44'],
  };

  beforeEach(() => {
    queueMatrixContext();
  });

  it('создаёт 4 варианта в ОДНОЙ транзакции (мина «в»)', async () => {
    queueVariantInserts(['v1', 'v2', 'v3', 'v4']);

    const res = await applyVariantMatrix(input);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (res.ok) {
      expect(res.data.created).toBe(4);
    }

    expect(H.state.beginCalls).toBe(1);
    expect(findCalls('INSERT INTO product_variants')).toHaveLength(4);
    expect(findCalls('INSERT INTO inventory')).toHaveLength(4);
  });

  it('в name пишется РАЗМЕР, цвет — отдельной привязкой EAV (мина 5)', async () => {
    queueVariantInserts(['v1', 'v2', 'v3', 'v4']);
    await applyVariantMatrix(input);

    const inserts = findCalls('INSERT INTO product_variants');
    const names = inserts.map((c) => c.args[2]);
    expect(names).toEqual(['42', '44', '42', '44']);
    for (const n of names) {
      expect(String(n)).not.toContain('Белый');
      expect(String(n)).not.toContain('Чёрный');
    }

    const eav = findCalls('INSERT INTO product_attributes');
    expect(eav).toHaveLength(4);
    // (product_id, variant_id, attribute_id, value_id)
    expect(eav[0]!.args).toEqual([PRODUCT, 'v1', COLOR_ATTR, WHITE_ID]);
    expect(eav[3]!.args).toEqual([PRODUCT, 'v4', COLOR_ATTR, BLACK_ID]);
  });

  it('НЕ трогает привязки уровня товара (мина «а»)', async () => {
    queueVariantInserts(['v1', 'v2', 'v3', 'v4']);
    await applyVariantMatrix(input);

    expect(findCalls('DELETE FROM product_attributes')).toHaveLength(0);
    for (const c of H.state.sqlCalls) {
      expect(c.text).not.toContain('variant_id IS NULL');
    }
  });

  it('один аудит и одна ревалидация на всю матрицу (мина «в»)', async () => {
    queueVariantInserts(['v1', 'v2', 'v3', 'v4']);
    await applyVariantMatrix(input);

    expect(H.writeAuditSpy).toHaveBeenCalledTimes(1);
    const entry = H.writeAuditSpy.mock.calls[0]![0] as {
      action: string;
      entityType: string;
      entityId: string;
    };
    expect(entry.action).toBe('catalog.variant.matrix.apply');
    expect(entry.entityType).toBe('product');
    expect(entry.entityId).toBe(PRODUCT);

    expect(H.revalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('пересобирает кеш атрибутов созданных вариантов', async () => {
    queueVariantInserts(['v1', 'v2', 'v3', 'v4']);
    await applyVariantMatrix(input);

    expect(H.rebuildVariantCacheSpy).toHaveBeenCalledTimes(1);
    expect(H.rebuildVariantCacheSpy.mock.calls[0]![1]).toEqual([
      'v1',
      'v2',
      'v3',
      'v4',
    ]);
  });
});

describe('applyVariantMatrix — sku (мина «б»)', () => {
  it('вставка идёт через ON CONFLICT DO NOTHING RETURNING и ретраится при занятом sku', async () => {
    queueMatrixContext([{ id: WHITE_ID, value: 'Белый' }]);
    // Первый кандидат sku занят (пустой RETURNING) → второй проходит.
    H.state.sqlResponses.push({
      match: 'INSERT INTO product_variants',
      rows: [],
      times: 1,
    });
    H.state.sqlResponses.push({
      match: 'INSERT INTO product_variants',
      rows: [{ id: 'v1' }],
      times: 1,
    });

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: COLOR_ATTR,
      colors: [WHITE_ID],
      sizes: ['42'],
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);

    const inserts = findCalls('INSERT INTO product_variants');
    expect(inserts).toHaveLength(2);
    expect(inserts[0]!.text).toContain('ON CONFLICT DO NOTHING');
    expect(inserts[0]!.text).toContain('RETURNING id');
    // База sku — slug ТОВАРА + транслит «цвет размер» (sku уникален глобально),
    // кандидаты различаются суффиксом.
    expect(inserts[0]!.args[1]).toBe(`${PRODUCT_SLUG}-belyy-42`);
    expect(inserts[1]!.args[1]).not.toBe(`${PRODUCT_SLUG}-belyy-42`);
  });
});

describe('applyVariantMatrix — существующие варианты', () => {
  it('существующая ячейка не дублируется, выключенная — включается обратно', async () => {
    queueMatrixContext([{ id: WHITE_ID, value: 'Белый' }]);
    H.state.sqlResponses.push({
      match: 'FROM product_variants v',
      rows: [
        {
          id: VAR_A,
          name: '42',
          is_active: false,
          sort: 3,
          color_value_id: WHITE_ID,
        },
      ],
    });
    queueVariantInserts(['v2']);

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: COLOR_ATTR,
      colors: [WHITE_ID],
      sizes: ['42', '44'],
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (res.ok) {
      expect(res.data.created).toBe(1);
      expect(res.data.activated).toBe(1);
    }

    const inserts = findCalls('INSERT INTO product_variants');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.args[2]).toBe('44');
    // sort продолжает существующую нумерацию (max sort + 1).
    expect(inserts[0]!.args[4]).toBe(4);

    const activate = findCalls('is_active = true');
    expect(activate).toHaveLength(1);
    expect(activate[0]!.args).toEqual([PRODUCT, [VAR_A]]);
  });

  it('без флага deactivateMissing лишние варианты не гасятся', async () => {
    queueMatrixContext([]);
    H.state.sqlResponses.push({
      match: 'FROM product_variants v',
      rows: [
        { id: VAR_A, name: '99', is_active: true, sort: 0, color_value_id: null },
      ],
    });
    queueVariantInserts(['v2']);

    await applyVariantMatrix({
      productId: PRODUCT,
      colors: [],
      sizes: ['42'],
    });

    expect(findCalls('is_active = false')).toHaveLength(0);
  });

  it('с флагом deactivateMissing лишние гасятся ОДНИМ запросом, без DELETE', async () => {
    queueMatrixContext([]);
    H.state.sqlResponses.push({
      match: 'FROM product_variants v',
      rows: [
        { id: VAR_A, name: '99', is_active: true, sort: 0, color_value_id: null },
      ],
    });
    queueVariantInserts(['v2']);

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colors: [],
      sizes: ['42'],
      deactivateMissing: true,
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (res.ok) expect(res.data.deactivated).toBe(1);

    const off = findCalls('is_active = false');
    expect(off).toHaveLength(1);
    expect(off[0]!.args).toEqual([PRODUCT, [VAR_A]]);
    // Варианты никогда не удаляются: order_items хранят их снимок.
    expect(findCalls('DELETE FROM product_variants')).toHaveLength(0);
  });
});

describe('applyVariantMatrix — справочник «Цвет» (мина «ж»)', () => {
  it('цвета выбраны, но справочник не найден → понятная ошибка вместо порчи данных', async () => {
    // colorAttributeId не передан и поиск по имени/коду ничего не вернул.
    H.state.sqlResponses.push({
      match: 'FROM products',
      rows: [{ slug: PRODUCT_SLUG }],
    });
    H.state.sqlResponses.push({ match: 'FROM attributes', rows: [] });

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colors: [WHITE_ID],
      sizes: ['42'],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('validation');
      expect(res.message).toContain('Цвет');
    }
    expect(findCalls('INSERT INTO product_variants')).toHaveLength(0);
  });

  it('без цветов справочник не требуется — матрица вырождается в список размеров', async () => {
    queueMatrixContext([]);
    queueVariantInserts(['v1', 'v2']);

    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colors: [],
      sizes: ['S', 'M'],
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);

    expect(findCalls('INSERT INTO product_variants')).toHaveLength(2);
    expect(findCalls('INSERT INTO product_attributes')).toHaveLength(0);
  });
});

describe('applyVariantMatrix — валидация', () => {
  it('пустой список размеров отклоняется схемой', async () => {
    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colors: [],
      sizes: [],
    });
    expect(res.ok).toBe(false);
  });

  it('слишком большая матрица отклоняется (защита от вставочного шторма)', async () => {
    const res = await applyVariantMatrix({
      productId: PRODUCT,
      colorAttributeId: COLOR_ATTR,
      colors: Array.from(
        { length: 20 },
        (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
      ),
      sizes: Array.from({ length: 20 }, (_, i) => `s${i}`),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('validation');
    expect(findCalls('INSERT INTO product_variants')).toHaveLength(0);
  });
});
