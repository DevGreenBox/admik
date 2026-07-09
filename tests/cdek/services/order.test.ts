import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Тесты OrderService (docs/08 §7.1).
 *
 * (а) ЧИСТЫЕ — normalizePhone, buildPayload (ПВЗ/курьер ветки), canCreateShipment,
 *     deliveryModeFor. Без сети/БД, всегда зелёные.
 * (б) createShipment — БД-зависим (repository + orders). Мокаем repository/orders
 *     через vi.mock, чтобы проверить mock-создание (uuid/трек сохранён) и
 *     идемпотентность повторного вызова без живой БД.
 */

// --- Моки БД-слоёв (до импорта тестируемого модуля). ---
const repoState: { shipment: Record<string, unknown> | null } = { shipment: null };
const createShipmentMock = vi.fn(async (input: Record<string, unknown>) => {
  repoState.shipment = { id: 'sh-1', orderId: input.orderId, ...input };
  return repoState.shipment;
});
const updateShipmentMock = vi.fn(async (_id: string, patch: Record<string, unknown>) => {
  repoState.shipment = { ...(repoState.shipment ?? {}), ...patch };
  return repoState.shipment;
});
const getShipmentMock = vi.fn(async () => repoState.shipment);
const bumpRetryMock = vi.fn(async () => repoState.shipment);

// Состояние tx-мока для applyDeliveryStatus (C6-1): SELECT delivery_status FOR UPDATE
// отдаёт deliveryStatus (фактический под локом), guarded UPDATE — updateCount строк.
const txState: { deliveryStatus: string | null; updateCount: number } = {
  deliveryStatus: null,
  updateCount: 1,
};

vi.mock('@/lib/cdek/repository', () => ({
  getShipmentByOrderId: (...a: unknown[]) => getShipmentMock(...(a as [])),
  getShipmentByCdekUuid: vi.fn(async () => null),
  createShipment: (...a: unknown[]) => createShipmentMock(...(a as [Record<string, unknown>])),
  updateShipmentByOrderId: (...a: unknown[]) =>
    updateShipmentMock(...(a as [string, Record<string, unknown>])),
  bumpShipmentRetry: (...a: unknown[]) => bumpRetryMock(...(a as [])),
}));

const getOrderByIdMock = vi.fn();
vi.mock('@/lib/orders/repository', () => ({
  getOrderById: (...a: unknown[]) => getOrderByIdMock(...(a as [])),
  getOrderByNumber: vi.fn(async () => null),
}));

// sql — заглушка (UPDATE orders денормализация + per-order advisory-lock внутри
// sql.begin). vi.mock hoisted → строим внутри. tx распознаёт
// pg_try_advisory_xact_lock и возвращает [{ locked:true }] (лок получен), чтобы
// критическая секция createShipment выполнялась; прочие запросы → [].
vi.mock('@/lib/db/client', () => {
  const tx = vi.fn(async (strings: TemplateStringsArray) => {
    const text = Array.isArray(strings) ? strings.join('') : String(strings);
    if (text.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
    // applyDeliveryStatus: SELECT delivery_status FOR UPDATE → фактический статус под локом.
    if (/SELECT\s+delivery_status/i.test(text)) {
      return txState.deliveryStatus === null ? [] : [{ delivery_status: txState.deliveryStatus }];
    }
    // applyDeliveryStatus: guarded UPDATE orders SET delivery_status → .count строк.
    if (/UPDATE\s+orders/i.test(text) && /delivery_status/i.test(text)) {
      const arr: unknown[] = [];
      (arr as unknown as { count: number }).count = txState.updateCount;
      return arr;
    }
    return [];
  });
  const fn = vi.fn(async () => []);
  return {
    sql: Object.assign(fn, { begin: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) }),
  };
});

import {
  OrderService,
  normalizePhone,
  buildPayload,
  buildWareKey,
  firstLegForTariff,
  FIRST_LEG_BY_TARIFF,
  canCreateShipment,
  isOrderPaidForShipment,
  shipmentBlockMessage,
  shipmentCreateUiState,
  wantsCdekShipmentOnOrder,
  deliveryModeFor,
  type BuildPayloadOptions,
} from '@/lib/cdek/services/order';
import { CdekManager } from '@/lib/cdek/manager';
import { getCdekConfig } from '@/lib/cdek/config';
import { CdekError } from '@/lib/cdek/errors';
import type { Order, OrderItem } from '@/lib/orders/types';

const mockCfg = getCdekConfig({ NODE_ENV: 'test' });

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'ord-1',
    number: 'TC-2026-000123',
    status: 'paid',
    itemsTotal: '1000.00',
    discountTotal: '0.00',
    deliveryTotal: '0.00',
    grandTotal: '1000.00',
    currency: 'RUB',
    paymentMethod: 'card',
    paymentStatus: 'paid',
    paidAt: new Date(),
    paymentRef: null,
    paymentProvider: null,
    deliveryType: 'pvz',
    deliveryStatus: 'pending',
    deliveryCity: 'Москва',
    deliveryCityCode: null,
    deliveryAddress: null,
    deliveryPvzCode: 'MSK1',
    deliveryCost: '0.00',
    cdekUuid: null,
    cdekTrack: null,
    promoCodeId: null,
    promoCode: null,
    customerId: null,
    customerName: 'Иван Иванов',
    customerEmail: 'ivan@example.com',
    customerPhone: '+7 (912) 345-67-89',
    comment: '',
    idempotencyKey: null,
    source: 'storefront',
    ip: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeItem(over: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'it-1',
    orderId: 'ord-1',
    productId: 'p-1',
    variantId: 'v-1',
    nameSnapshot: 'Чехол',
    skuSnapshot: 'SKU1',
    attributesSnapshot: {},
    unitPrice: '500.00',
    compareAtSnapshot: null,
    quantity: 2,
    lineTotal: '1000.00',
    isGift: false,
    weightG: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    createdAt: new Date(),
    ...over,
  };
}

// Базовые опции: тарифы по умолчанию (136/137) — «от склада», поэтому задан
// shipment_point (обязателен для warehouse-тарифов, Приложение 4 apidoc.cdek.ru).
const buildOpts: BuildPayloadOptions = {
  defaultDimensions: mockCfg.defaultDimensions,
  fromLocationCode: mockCfg.fromLocationCode,
  fromAddress: null,
  shipmentPoint: 'WH-1',
  defaultTariffCode: mockCfg.defaultTariffCode,
  doorTariffCode: mockCfg.doorTariffCode,
  sender: { name: 'ООО Тест', contactName: 'Менеджер', phone: '+79000000000', email: 's@e.ru', inn: '7700000000' },
};

describe('cdek/order — normalizePhone (чистая)', () => {
  it('10 цифр → +7XXXXXXXXXX', () => {
    expect(normalizePhone('9123456789')).toBe('+79123456789');
  });
  it('11 цифр с 8 → +7…', () => {
    expect(normalizePhone('89123456789')).toBe('+79123456789');
  });
  it('11 цифр с 7 → +7…', () => {
    expect(normalizePhone('79123456789')).toBe('+79123456789');
  });
  it('форматированный (+7 (912) …) → нормализуется', () => {
    expect(normalizePhone('+7 (912) 345-67-89')).toBe('+79123456789');
  });
  it('слишком короткий → ошибка', () => {
    expect(() => normalizePhone('12345')).toThrow();
  });
});

describe('cdek/order — deliveryModeFor / canCreateShipment (чистые)', () => {
  it('courier → door, pvz → pvz', () => {
    expect(deliveryModeFor(makeOrder({ deliveryType: 'courier' }))).toBe('door');
    expect(deliveryModeFor(makeOrder({ deliveryType: 'pvz' }))).toBe('pvz');
  });
  it('pickup → нельзя создавать', () => {
    expect(canCreateShipment(makeOrder({ deliveryType: 'pickup' })).ok).toBe(false);
  });
  it('неоплаченный заказ → нельзя (reason=not_paid)', () => {
    const o = makeOrder({ paymentStatus: 'pending', status: 'awaiting_payment' });
    const res = canCreateShipment(o);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not_paid');
  });
  it('оплаченный курьерский → можно', () => {
    expect(canCreateShipment(makeOrder({ deliveryType: 'courier', paymentStatus: 'paid' })).ok).toBe(true);
  });
  // Режим «накладная при заказе» (магазин без онлайн-кассы): снимаем гейт оплаты.
  it('createOnOrder=true: неоплаченный курьерский → можно', () => {
    const o = makeOrder({ deliveryType: 'courier', paymentStatus: 'pending', status: 'new' });
    expect(canCreateShipment(o, { createOnOrder: true }).ok).toBe(true);
  });
  it('createOnOrder=true: самовывоз всё равно нельзя (reason=pickup)', () => {
    const res = canCreateShipment(makeOrder({ deliveryType: 'pickup' }), { createOnOrder: true });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('pickup');
  });
  it('createOnOrder НЕ задан: неоплаченный → по-прежнему not_paid (обратная совместимость)', () => {
    const res = canCreateShipment(makeOrder({ paymentStatus: 'pending', status: 'awaiting_payment' }));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not_paid');
  });
});

// UI-состояние блока создания отправления в карточке заказа (демо «без оплаты»):
// кнопка ручного создания должна быть доступна оператору и для НЕОПЛАЧЕННОГО
// заказа, когда включён режим без кассы (createOnOrder) — иначе UI прячет её в
// обход разрешающего сервера (paymentReady не учитывал createOnOrder).
describe('cdek/order — shipmentCreateUiState (UI-гейт кнопки, зеркало canCreateShipment)', () => {
  const base = { hasShipment: false, isPickup: false, paymentReady: false, createOnOrder: false };
  it('оплачен, отправления нет → кнопка есть, уведомлений нет', () => {
    expect(shipmentCreateUiState({ ...base, paymentReady: true })).toEqual({
      showCreateButton: true,
      showAwaitPaymentNotice: false,
      showCreateWithoutPaymentHint: false,
    });
  });
  it('НЕ оплачен, режим без кассы ВЫКЛ → кнопки нет, показываем «после оплаты»', () => {
    expect(shipmentCreateUiState({ ...base })).toEqual({
      showCreateButton: false,
      showAwaitPaymentNotice: true,
      showCreateWithoutPaymentHint: false,
    });
  });
  it('НЕ оплачен, режим без кассы ВКЛ → кнопка есть, «после оплаты» скрыто, подсказка «без оплаты» видна (демо-фикс)', () => {
    expect(shipmentCreateUiState({ ...base, createOnOrder: true })).toEqual({
      showCreateButton: true,
      showAwaitPaymentNotice: false,
      showCreateWithoutPaymentHint: true,
    });
  });
  it('самовывоз → ни кнопки, ни уведомлений (даже с createOnOrder)', () => {
    expect(shipmentCreateUiState({ ...base, isPickup: true, createOnOrder: true })).toEqual({
      showCreateButton: false,
      showAwaitPaymentNotice: false,
      showCreateWithoutPaymentHint: false,
    });
  });
  it('отправление уже есть → кнопки создания нет, уведомлений нет (даже если не оплачен)', () => {
    expect(shipmentCreateUiState({ ...base, hasShipment: true })).toEqual({
      showCreateButton: false,
      showAwaitPaymentNotice: false,
      showCreateWithoutPaymentHint: false,
    });
  });
});

// Гейт авто-создания накладной при оформлении (демо «без оплаты» + инвариант
// module toggle из аудита 2026-07-09, находка #6).
describe('cdek/order — wantsCdekShipmentOnOrder (гейт авто-создания в чекауте)', () => {
  const base = { reused: false, createOnOrder: true, deliveryType: 'courier', cdekModuleEnabled: true };
  it('все условия выполнены → true', () => {
    expect(wantsCdekShipmentOnOrder({ ...base })).toBe(true);
  });
  it('createOnOrder выкл → false (штатный режим с кассой)', () => {
    expect(wantsCdekShipmentOnOrder({ ...base, createOnOrder: false })).toBe(false);
  });
  it('повторный (reused) заказ → false (idempotency, СДЭК не дёргаем)', () => {
    expect(wantsCdekShipmentOnOrder({ ...base, reused: true })).toBe(false);
  });
  it('самовывоз → false', () => {
    expect(wantsCdekShipmentOnOrder({ ...base, deliveryType: 'pickup' })).toBe(false);
  });
  it('модуль cdek ВЫКЛЮЧЕН → false (единый рубильник, не ходим в СДЭК)', () => {
    expect(wantsCdekShipmentOnOrder({ ...base, cdekModuleEnabled: false })).toBe(false);
  });
});

describe('cdek/order — isOrderPaidForShipment (FF.md: накладная только после оплаты)', () => {
  it('payment_status=paid → оплачен (хотя бы статус заказа new)', () => {
    expect(isOrderPaidForShipment({ paymentStatus: 'paid', status: 'new' })).toBe(true);
  });
  it('payment_status=pending + статус awaiting_payment → НЕ оплачен', () => {
    expect(isOrderPaidForShipment({ paymentStatus: 'pending', status: 'awaiting_payment' })).toBe(false);
  });
  it('статус продвинут оператором за оплату (packed) → считаем оплаченным', () => {
    expect(isOrderPaidForShipment({ paymentStatus: 'pending', status: 'packed' })).toBe(true);
  });
  it('новый неоплаченный заказ → НЕ оплачен (накладная недоступна)', () => {
    expect(isOrderPaidForShipment({ paymentStatus: 'pending', status: 'new' })).toBe(false);
  });
  it('сообщение про блокировку not_paid упоминает оплату', () => {
    expect(shipmentBlockMessage('not_paid')).toMatch(/оплат/i);
  });
});

describe('cdek/order — buildPayload (чистая)', () => {
  it('ПВЗ-режим → delivery_point = код ПВЗ', () => {
    const p = buildPayload(makeOrder({ deliveryType: 'pvz', deliveryPvzCode: 'MSK1' }), [makeItem()], buildOpts);
    expect(p.delivery_point).toBe('MSK1');
    expect(p.to_location).toBeUndefined();
    expect(p.type).toBe(1);
    expect(p.number).toBe('TC-2026-000123');
    expect(p.recipient.phones[0].number).toBe('+79123456789');
  });

  it('курьер (door) → to_location, без delivery_point', () => {
    const p = buildPayload(
      makeOrder({ deliveryType: 'courier', deliveryAddress: 'ул. Ленина, 1', deliveryPvzCode: null }),
      [makeItem()],
      buildOpts,
    );
    expect(p.delivery_point).toBeUndefined();
    expect(p.to_location).toBeDefined();
    expect(p.to_location?.address).toBe('ул. Ленина, 1');
  });

  it('M4: ПВЗ-режим → tariff_code = defaultTariffCode (склад-склад 136)', () => {
    const p = buildPayload(makeOrder({ deliveryType: 'pvz', deliveryPvzCode: 'MSK1' }), [makeItem()], buildOpts);
    expect(p.tariff_code).toBe(buildOpts.defaultTariffCode);
    expect(p.tariff_code).toBe(136);
  });

  it('M4: курьер (door) → tariff_code = doorTariffCode (склад-дверь 137), НЕ ПВЗ-тариф', () => {
    const p = buildPayload(
      makeOrder({ deliveryType: 'courier', deliveryAddress: 'ул. Ленина, 1', deliveryPvzCode: null }),
      [makeItem()],
      buildOpts,
    );
    expect(p.tariff_code).toBe(buildOpts.doorTariffCode);
    expect(p.tariff_code).toBe(137);
    expect(p.tariff_code).not.toBe(buildOpts.defaultTariffCode);
  });

  it('shipment_point взаимоисключим с from_location', () => {
    const p = buildPayload(makeOrder(), [makeItem()], { ...buildOpts, shipmentPoint: 'WH-1' });
    expect(p.shipment_point).toBe('WH-1');
    expect(p.from_location).toBeUndefined();
  });

  it('packages агрегирует вес позиций (qty × дефолт), когда снимок пуст', () => {
    const p = buildPayload(makeOrder(), [makeItem({ quantity: 2 })], buildOpts);
    // 2 × дефолтный вес магазина (снимок позиции NULL → дефолт)
    expect(p.packages[0].weight).toBe(buildOpts.defaultDimensions.weightG * 2);
    expect(p.packages[0].items).toHaveLength(1);
    // ware_key — из SKU-снимка (лимит string(20) СДЭК), НЕ UUID варианта (36 симв.)
    expect(p.packages[0].items[0].ware_key).toBe('SKU1');
    // item-уровень тоже на дефолте (вес единицы)
    expect(p.packages[0].items[0].weight).toBe(buildOpts.defaultDimensions.weightG);
  });

  it('packages берёт РЕАЛЬНЫЙ вес/габариты из снимка позиции (а не дефолт)', () => {
    const item = makeItem({ quantity: 2, weightG: 300, lengthCm: 25, widthCm: 12, heightCm: 4 });
    const p = buildPayload(makeOrder(), [item], buildOpts);
    expect(p.packages[0].weight).toBe(300 * 2); // Σ(weightG × qty)
    expect(p.packages[0].length).toBe(25); // max
    expect(p.packages[0].width).toBe(12); // max
    expect(p.packages[0].height).toBe(4 * 2); // Σ(qty × h)
    // item-уровень: вес ЕДИНИЦЫ из снимка
    expect(p.packages[0].items[0].weight).toBe(300);
  });

  it('несколько позиций: вес агрегируется по реальным снимкам', () => {
    const p = buildPayload(
      makeOrder(),
      [
        makeItem({ id: 'a', quantity: 2, weightG: 300, heightCm: 5 }),
        makeItem({ id: 'b', quantity: 1, weightG: 500, heightCm: 8 }),
      ],
      buildOpts,
    );
    expect(p.packages[0].weight).toBe(300 * 2 + 500); // 1100
    expect(p.packages[0].height).toBe(5 * 2 + 8); // 18
  });

  it('ПВЗ-режим без кода ПВЗ → ошибка', () => {
    expect(() =>
      buildPayload(makeOrder({ deliveryType: 'pvz', deliveryPvzCode: null }), [makeItem()], buildOpts),
    ).toThrow();
  });
});

// =============================================================================
// Фикс 1 (критический): ware_key ≤ 20 символов + уникальность внутри упаковки.
// =============================================================================

describe('cdek/order — buildWareKey (лимит string(20), уникальность)', () => {
  it('SKU ≤ 20 символов → как есть (после trim)', () => {
    expect(buildWareKey({ skuSnapshot: '  SKU-42  ', id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })).toBe('SKU-42');
  });

  it('длинный SKU (> 20) → обрезка до 20 символов', () => {
    const long = 'VERY-LONG-SKU-1234567890-EXTRA';
    const key = buildWareKey({ skuSnapshot: long, id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    expect(key).toBe(long.slice(0, 20));
    expect(key.length).toBe(20);
  });

  it('пустой SKU → UUID позиции без дефисов, первые 20', () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const key = buildWareKey({ skuSnapshot: '   ', id });
    expect(key).toBe(id.replace(/-/g, '').slice(0, 20));
    expect(key.length).toBe(20);
  });

  it('коллизия после обрезки → суффикс -2/-3, лимит 20 сохраняется', () => {
    const used = new Set<string>();
    const long = 'SAME-LONG-SKU-1234567890';
    const k1 = buildWareKey({ skuSnapshot: long, id: 'id-1' }, used);
    const k2 = buildWareKey({ skuSnapshot: long, id: 'id-2' }, used);
    const k3 = buildWareKey({ skuSnapshot: long, id: 'id-3' }, used);
    expect(k1).toBe(long.slice(0, 20));
    expect(k2).toBe(`${long.slice(0, 18)}-2`);
    expect(k3).toBe(`${long.slice(0, 18)}-3`);
    expect(new Set([k1, k2, k3]).size).toBe(3);
    for (const k of [k1, k2, k3]) expect(k.length).toBeLessThanOrEqual(20);
  });

  it('buildPayload: ware_key уникальны внутри packages[].items[] при одинаковом SKU', () => {
    const p = buildPayload(
      makeOrder(),
      [
        makeItem({ id: 'a', skuSnapshot: 'DUPLICATE-SKU-1234567890' }),
        makeItem({ id: 'b', skuSnapshot: 'DUPLICATE-SKU-1234567890' }),
      ],
      buildOpts,
    );
    const keys = p.packages[0].items.map((i) => i.ware_key);
    expect(new Set(keys).size).toBe(2);
    for (const k of keys) expect(k.length).toBeLessThanOrEqual(20);
  });
});

// =============================================================================
// Фикс 3 (high): первое плечо тарифа — shipment_point vs from_location.
// =============================================================================

describe('cdek/order — buildPayload: первое плечо тарифа (Приложение 4 apidoc.cdek.ru)', () => {
  it('справочник FIRST_LEG_BY_TARIFF: 136/137/233/234/368 → warehouse; 138/139/366 → door', () => {
    for (const t of [136, 137, 233, 234, 368]) expect(FIRST_LEG_BY_TARIFF[t]).toBe('warehouse');
    for (const t of [138, 139, 366]) expect(FIRST_LEG_BY_TARIFF[t]).toBe('door');
  });

  it('неизвестный тариф → warehouse (безопасный дефолт для ИМ)', () => {
    expect(firstLegForTariff(999)).toBe('warehouse');
  });

  it('warehouse-тариф без CDEK_SHIPMENT_POINT → cdek_shipment_point_required с текстом для оператора', () => {
    try {
      buildPayload(makeOrder(), [makeItem()], { ...buildOpts, shipmentPoint: null });
      expect.unreachable('должен был бросить');
    } catch (err) {
      expect(err).toBeInstanceOf(CdekError);
      expect((err as CdekError).code).toBe('cdek_shipment_point_required');
      expect((err as CdekError).message).toMatch(/CDEK_SHIPMENT_POINT/);
    }
  });

  it('door-тариф (139) → from_location {code, address}; shipment_point отсутствует даже при заданном', () => {
    const p = buildPayload(
      makeOrder({ deliveryType: 'courier', deliveryAddress: 'ул. Ленина, 1', deliveryPvzCode: null }),
      [makeItem()],
      {
        ...buildOpts,
        doorTariffCode: 139,
        shipmentPoint: 'WH-1', // должен быть проигнорирован для тарифа «от двери»
        fromAddress: 'Москва, ул. Складская, 5',
      },
    );
    expect(p.tariff_code).toBe(139);
    expect(p.shipment_point).toBeUndefined();
    expect(p.from_location).toEqual({
      code: buildOpts.fromLocationCode,
      address: 'Москва, ул. Складская, 5',
    });
  });

  it('door-тариф без CDEK_FROM_ADDRESS → cdek_from_address_required', () => {
    try {
      buildPayload(
        makeOrder({ deliveryType: 'courier', deliveryAddress: 'ул. Ленина, 1', deliveryPvzCode: null }),
        [makeItem()],
        { ...buildOpts, doorTariffCode: 139, fromAddress: null },
      );
      expect.unreachable('должен был бросить');
    } catch (err) {
      expect((err as CdekError).code).toBe('cdek_from_address_required');
    }
  });
});

// =============================================================================
// Фикс 4 (high): to_location курьерки — address + идентификация города.
// =============================================================================

describe('cdek/order — buildPayload: to_location для курьерки', () => {
  const courier = (over: Partial<Order> = {}) =>
    makeOrder({ deliveryType: 'courier', deliveryPvzCode: null, deliveryAddress: 'ул. Ленина, 1', ...over });

  it('deliveryCityCode → to_location = {code, city, address}', () => {
    const p = buildPayload(courier({ deliveryCityCode: 44, deliveryCity: 'Москва' }), [makeItem()], buildOpts);
    expect(p.to_location).toEqual({ code: 44, city: 'Москва', address: 'ул. Ленина, 1' });
  });

  it('без cityCode, но с city → to_location = {city, address} без code', () => {
    const p = buildPayload(courier({ deliveryCityCode: null, deliveryCity: 'Казань' }), [makeItem()], buildOpts);
    expect(p.to_location).toEqual({ city: 'Казань', address: 'ул. Ленина, 1' });
  });

  it('пустой адрес → cdek_address_required', () => {
    try {
      buildPayload(courier({ deliveryAddress: null }), [makeItem()], buildOpts);
      expect.unreachable('должен был бросить');
    } catch (err) {
      expect((err as CdekError).code).toBe('cdek_address_required');
    }
  });

  it('нет ни code, ни city → cdek_city_required', () => {
    try {
      buildPayload(courier({ deliveryCityCode: null, deliveryCity: null }), [makeItem()], buildOpts);
      expect.unreachable('должен был бросить');
    } catch (err) {
      expect((err as CdekError).code).toBe('cdek_city_required');
    }
  });
});

// =============================================================================
// Фикс 8 (medium): sender — не слать пустой объект, нормализовать телефон.
// =============================================================================

describe('cdek/order — buildPayload: sender', () => {
  const emptySender = { name: null, contactName: null, phone: null, email: null, inn: null };

  it('все поля sender пусты → ключ sender отсутствует в payload', () => {
    const p = buildPayload(makeOrder(), [makeItem()], { ...buildOpts, sender: emptySender });
    expect('sender' in p).toBe(false);
  });

  it('телефон отправителя нормализуется (8… → +7…)', () => {
    const p = buildPayload(makeOrder(), [makeItem()], {
      ...buildOpts,
      sender: { ...emptySender, phone: '8 (900) 123-45-67' },
    });
    expect(p.sender?.phones).toEqual([{ number: '+79001234567' }]);
  });

  it('некорректный телефон отправителя → CdekError с упоминанием CDEK_SENDER_PHONE', () => {
    try {
      buildPayload(makeOrder(), [makeItem()], {
        ...buildOpts,
        sender: { ...emptySender, phone: '12345' },
      });
      expect.unreachable('должен был бросить');
    } catch (err) {
      expect(err).toBeInstanceOf(CdekError);
      expect((err as CdekError).message).toMatch(/CDEK_SENDER_PHONE/);
    }
  });
});

describe('cdek/order — createShipment (mock-создание, repository замокан)', () => {
  beforeEach(() => {
    repoState.shipment = null;
    vi.clearAllMocks();
    getOrderByIdMock.mockResolvedValue({ order: makeOrder(), items: [makeItem()] });
  });

  it('mock: создаёт отправление с фейковым uuid/треком, is_mock=true', async () => {
    const svc = new OrderService(new CdekManager({ config: mockCfg }));
    const sh = await svc.createShipment('ord-1');
    expect(createShipmentMock).toHaveBeenCalledTimes(1);
    expect(String((sh as unknown as Record<string, unknown>).cdekUuid)).toMatch(/^mock-/);
    expect(String((sh as unknown as Record<string, unknown>).cdekNumber)).toMatch(/^1\d{9}$/);
    expect((sh as unknown as Record<string, unknown>).isMock).toBe(true);
  });

  it('идемпотентность: повторный createShipment не создаёт второе отправление', async () => {
    const svc = new OrderService(new CdekManager({ config: mockCfg }));
    const first = await svc.createShipment('ord-1');
    createShipmentMock.mockClear();
    // повтор — отправление уже с cdek_uuid → возвращается существующее
    const second = await svc.createShipment('ord-1');
    expect(createShipmentMock).not.toHaveBeenCalled();
    expect((second as unknown as Record<string, unknown>).cdekUuid).toBe((first as unknown as Record<string, unknown>).cdekUuid);
  });

  it('pickup → precondition ошибка', async () => {
    getOrderByIdMock.mockResolvedValue({ order: makeOrder({ deliveryType: 'pickup' }), items: [makeItem()] });
    const svc = new OrderService(new CdekManager({ config: mockCfg }));
    await expect(svc.createShipment('ord-1')).rejects.toThrow();
  });
});

describe('cdek/order — cancelShipment (БАГ #12: нет рассинхрона отправление↔delivery_status)', () => {
  beforeEach(() => {
    repoState.shipment = null;
    txState.deliveryStatus = null;
    txState.updateCount = 1;
    vi.clearAllMocks();
  });

  it('delivery_status=in_transit → precondition CdekError, отправление НЕ помечается CANCELLED, СДЭК не дёргается', async () => {
    repoState.shipment = { id: 'sh-1', orderId: 'ord-1', cdekUuid: 'mock-uuid-1' };
    getShipmentMock.mockResolvedValue(repoState.shipment);
    getOrderByIdMock.mockResolvedValue({
      order: makeOrder({ deliveryStatus: 'in_transit' }),
      items: [makeItem()],
    });
    const svc = new OrderService(new CdekManager({ config: mockCfg }));
    await expect(svc.cancelShipment('ord-1')).rejects.toThrow();
    // Главное: НЕ перевели отправление в CANCELLED (иначе рассинхрон с in_transit).
    expect(updateShipmentMock).not.toHaveBeenCalled();
  });

  it('delivery_status=delivered → precondition CdekError, отправление НЕ помечается CANCELLED', async () => {
    repoState.shipment = { id: 'sh-1', orderId: 'ord-1', cdekUuid: 'mock-uuid-1' };
    getShipmentMock.mockResolvedValue(repoState.shipment);
    getOrderByIdMock.mockResolvedValue({
      order: makeOrder({ deliveryStatus: 'delivered' }),
      items: [makeItem()],
    });
    const svc = new OrderService(new CdekManager({ config: mockCfg }));
    await expect(svc.cancelShipment('ord-1')).rejects.toThrow();
    expect(updateShipmentMock).not.toHaveBeenCalled();
  });

  it('delivery_status=pending → отмена проходит, отправление помечается CANCELLED', async () => {
    repoState.shipment = { id: 'sh-1', orderId: 'ord-1', cdekUuid: 'mock-uuid-1' };
    getShipmentMock.mockResolvedValue(repoState.shipment);
    getOrderByIdMock.mockResolvedValue({
      order: makeOrder({ deliveryStatus: 'pending' }),
      items: [makeItem()],
    });
    txState.deliveryStatus = 'pending'; // под локом статус тот же → переход применится
    const svc = new OrderService(new CdekManager({ config: mockCfg }));
    await expect(svc.cancelShipment('ord-1')).resolves.toBeUndefined();
    expect(updateShipmentMock).toHaveBeenCalledTimes(1);
    const patch = updateShipmentMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.statusCode).toBe('CANCELLED');
  });

  it('delivery_status=registered → отмена проходит (переход registered → cancelled допустим)', async () => {
    repoState.shipment = { id: 'sh-1', orderId: 'ord-1', cdekUuid: 'mock-uuid-1' };
    getShipmentMock.mockResolvedValue(repoState.shipment);
    getOrderByIdMock.mockResolvedValue({
      order: makeOrder({ deliveryStatus: 'registered' }),
      items: [makeItem()],
    });
    txState.deliveryStatus = 'registered';
    const svc = new OrderService(new CdekManager({ config: mockCfg }));
    await expect(svc.cancelShipment('ord-1')).resolves.toBeUndefined();
    expect(updateShipmentMock).toHaveBeenCalledTimes(1);
  });

  it('C6-1: гонка — precondition прошла (registered), но под FOR UPDATE статус уже in_transit → CdekError, отправление НЕ помечается CANCELLED', async () => {
    // Параллельный webhook продвинул статус между ранней precondition и переходом.
    repoState.shipment = { id: 'sh-1', orderId: 'ord-1', cdekUuid: 'mock-uuid-1' };
    getShipmentMock.mockResolvedValue(repoState.shipment);
    getOrderByIdMock.mockResolvedValue({
      order: makeOrder({ deliveryStatus: 'registered' }), // ранняя precondition: отмена допустима
      items: [makeItem()],
    });
    txState.deliveryStatus = 'in_transit'; // но под локом уже in_transit → переход не применится
    const svc = new OrderService(new CdekManager({ config: mockCfg }));
    await expect(svc.cancelShipment('ord-1')).rejects.toThrow();
    // Ключевое (анти-рассинхрон C6-1): отправление НЕ помечено CANCELLED.
    expect(updateShipmentMock).not.toHaveBeenCalled();
  });

  it('нет отправления (cdek_uuid пуст) → CdekError, отправление не трогаем', async () => {
    repoState.shipment = null;
    getShipmentMock.mockResolvedValue(null);
    const svc = new OrderService(new CdekManager({ config: mockCfg }));
    await expect(svc.cancelShipment('ord-1')).rejects.toThrow();
    expect(updateShipmentMock).not.toHaveBeenCalled();
  });
});

/** Конфиг real-режима для тестов (warehouse-тарифы 136/137 требуют shipment_point). */
const REAL_ENV = {
  NODE_ENV: 'test',
  CDEK_ACCOUNT: 'acc',
  CDEK_SECRET: 'sec',
  CDEK_BASE_URL: 'https://api.edu.cdek.ru',
  CDEK_SHIPMENT_POINT: 'WH-1',
} as Record<string, string>;

/** Сервис на stub-менеджере (real, client.request замокан напрямую). */
function stubRealService(request: ReturnType<typeof vi.fn>): OrderService {
  const manager = {
    isMock: false,
    config: getCdekConfig(REAL_ENV),
    client: { request },
  } as unknown as CdekManager;
  return new OrderService(manager);
}

describe('cdek/order — createShipment (real, замоканный client)', () => {
  beforeEach(() => {
    repoState.shipment = null;
    vi.clearAllMocks();
    getOrderByIdMock.mockResolvedValue({ order: makeOrder(), items: [makeItem()] });
  });

  it('real: POST /v2/orders, uuid из entity сохраняется', async () => {
    const realCfg = getCdekConfig(REAL_ENV);
    const fetchImpl = vi.fn(async (url: string) => {
      expect(String(url)).toContain('/v2/orders');
      return new Response(JSON.stringify({ entity: { uuid: 'real-uuid-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const tokenCache = { getToken: vi.fn(async () => 'tok'), invalidate: vi.fn(async () => {}) };
    const svc = new OrderService(new CdekManager({ config: realCfg, fetchImpl, tokenCache }));
    const sh = await svc.createShipment('ord-1');
    expect((sh as unknown as Record<string, unknown>).cdekUuid).toBe('real-uuid-1');
    expect((sh as unknown as Record<string, unknown>).isMock).toBe(false);
  });
});

// =============================================================================
// Фикс 2 (критический): разбор requests[].state ответа 202 POST /v2/orders.
// =============================================================================

describe('cdek/order — create(): разбор requests[] ответа 202', () => {
  it('requests[].state=INVALID → cdek_create_invalid с code/message ошибок; uuid НЕ принят', async () => {
    const request = vi.fn(async () => ({
      entity: { uuid: 'must-not-be-used' },
      requests: [
        {
          request_uuid: 'r1',
          type: 'CREATE',
          state: 'INVALID',
          errors: [{ code: 'v2_field_is_empty', message: 'recipient.phones is empty' }],
        },
      ],
    }));
    const svc = stubRealService(request);
    try {
      await svc.create({ number: 'X' } as never);
      expect.unreachable('должен был бросить');
    } catch (err) {
      expect(err).toBeInstanceOf(CdekError);
      const e = err as CdekError;
      expect(e.code).toBe('cdek_create_invalid');
      expect(e.message).toContain('v2_field_is_empty');
      expect(e.message).toContain('recipient.phones is empty');
      expect(e.cdekErrors).toEqual([
        { code: 'v2_field_is_empty', message: 'recipient.phones is empty' },
      ]);
    }
  });

  it('requests[].errors[] без явного INVALID → тоже cdek_create_invalid', async () => {
    const request = vi.fn(async () => ({
      entity: { uuid: 'u-1' },
      requests: [
        { type: 'CREATE', state: 'ACCEPTED', errors: [{ code: 'some_error', message: 'oops' }] },
      ],
    }));
    await expect(stubRealService(request).create({} as never)).rejects.toMatchObject({
      code: 'cdek_create_invalid',
    });
  });

  it('state=ACCEPTED без ошибок + entity.uuid → успех', async () => {
    const request = vi.fn(async () => ({
      entity: { uuid: 'u-ok' },
      requests: [{ type: 'CREATE', state: 'ACCEPTED', errors: [], warnings: [] }],
    }));
    await expect(stubRealService(request).create({} as never)).resolves.toEqual({ uuid: 'u-ok' });
  });

  it('state=WAITING без ошибок + entity.uuid → успех', async () => {
    const request = vi.fn(async () => ({
      entity: { uuid: 'u-wait' },
      requests: [{ type: 'CREATE', state: 'WAITING' }],
    }));
    await expect(stubRealService(request).create({} as never)).resolves.toEqual({ uuid: 'u-wait' });
  });

  it('нет entity.uuid (и нет ошибок) → cdek_create_no_uuid', async () => {
    const request = vi.fn(async () => ({ requests: [{ type: 'CREATE', state: 'ACCEPTED' }] }));
    await expect(stubRealService(request).create({} as never)).rejects.toMatchObject({
      code: 'cdek_create_no_uuid',
    });
  });
});

// =============================================================================
// Фикс 5 (high): сверка GET /v2/orders?im_number вместо слепого повтора POST.
// =============================================================================

describe('cdek/order — createShipment (real): сверка по im_number', () => {
  const tokenCache = { getToken: vi.fn(async () => 'tok'), invalidate: vi.fn(async () => {}) };

  function realService(fetchImpl: typeof fetch): OrderService {
    return new OrderService(
      new CdekManager({ config: getCdekConfig(REAL_ENV), fetchImpl, tokenCache }),
    );
  }

  beforeEach(() => {
    repoState.shipment = null;
    vi.clearAllMocks();
    getOrderByIdMock.mockResolvedValue({ order: makeOrder(), items: [makeItem()] });
  });

  it('сетевой сбой POST (unconfirmed) → немедленная сверка GET ?im_number: найден → uuid принят БЕЗ второго POST', async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url: String(url) });
      if (method === 'POST') throw new TypeError('fetch failed'); // сеть оборвалась
      return new Response(JSON.stringify({ entity: { uuid: 'recovered-uuid' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const sh = await realService(fetchImpl).createShipment('ord-1');
    expect((sh as unknown as Record<string, unknown>).cdekUuid).toBe('recovered-uuid');
    // Ровно один POST (не повторялся) + сверка GET с im_number номера заказа.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    const gets = calls.filter((c) => c.method === 'GET');
    expect(gets).toHaveLength(1);
    expect(gets[0]!.url).toContain('im_number=TC-2026-000123');
  });

  it('сетевой сбой POST → сверка не нашла заказ (404 v2_entity_not_found_im_number) → исходная unconfirmed-ошибка', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST') throw new TypeError('fetch failed');
      return new Response(
        JSON.stringify({ errors: [{ code: 'v2_entity_not_found_im_number', message: 'not found' }] }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    await expect(realService(fetchImpl).createShipment('ord-1')).rejects.toMatchObject({
      code: 'cdek_network_error_unconfirmed',
    });
    // Ошибка зафиксирована для cron-ретрая.
    expect(bumpRetryMock).toHaveBeenCalled();
  });

  it('прошлая попытка неуспешна (existing.error) → СНАЧАЛА сверка GET; найден → успех вовсе без POST', async () => {
    repoState.shipment = { id: 'sh-1', orderId: 'ord-1', cdekUuid: null, error: 'прошлый сбой' };
    getShipmentMock.mockResolvedValue(repoState.shipment);

    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(method);
      if (method !== 'GET') throw new Error(`неожиданный ${method} — сверка должна была найти заказ`);
      return new Response(JSON.stringify({ entity: { uuid: 'found-by-im-number' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await realService(fetchImpl).createShipment('ord-1');
    expect(calls).toEqual(['GET']); // ни одного POST
    // Существующая запись обновлена найденным uuid (clearError — прошлая ошибка сброшена).
    const patch = updateShipmentMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.cdekUuid).toBe('found-by-im-number');
    expect(patch.clearError).toBe(true);
  });

  it('existing.error → сверка не нашла (404) → выполняется обычный POST (создание)', async () => {
    repoState.shipment = { id: 'sh-1', orderId: 'ord-1', cdekUuid: null, error: 'прошлый сбой' };
    getShipmentMock.mockResolvedValue(repoState.shipment);

    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(method);
      if (method === 'GET') {
        return new Response(
          JSON.stringify({ errors: [{ code: 'v2_entity_not_found_im_number', message: 'nf' }] }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ entity: { uuid: 'fresh-uuid' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await realService(fetchImpl).createShipment('ord-1');
    expect(calls).toEqual(['GET', 'POST']); // сверка → создание
    const patch = updateShipmentMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.cdekUuid).toBe('fresh-uuid');
  });
});

// =============================================================================
// Фиксы 6–7 (medium): отказ POST …/refusal вместо PATCH {}; разбор DELETE-ответа.
// =============================================================================

describe('cdek/order — cancel(): refusal и разбор DELETE-ответа', () => {
  beforeEach(() => {
    repoState.shipment = null;
    txState.deliveryStatus = null;
    txState.updateCount = 1;
    vi.clearAllMocks();
  });

  it('afterAcceptance=true → POST /v2/orders/{uuid}/refusal (НЕ PATCH), успех при ACCEPTED', async () => {
    const request = vi.fn(async () => ({
      entity: { uuid: 'u-1' },
      requests: [{ type: 'REFUSAL', state: 'ACCEPTED' }],
    }));
    await expect(stubRealService(request).cancel('u-1', true)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    const [method, path] = request.mock.calls[0] as unknown as [string, string];
    expect(method).toBe('POST');
    expect(path).toBe('/v2/orders/u-1/refusal');
  });

  it('refusal → requests[].state=INVALID → CdekError с деталями ошибок', async () => {
    const request = vi.fn(async () => ({
      entity: { uuid: 'u-1' },
      requests: [
        { type: 'REFUSAL', state: 'INVALID', errors: [{ code: 'v2_refusal_error', message: 'нельзя' }] },
      ],
    }));
    try {
      await stubRealService(request).cancel('u-1', true);
      expect.unreachable('должен был бросить');
    } catch (err) {
      expect(err).toBeInstanceOf(CdekError);
      expect((err as CdekError).message).toContain('v2_refusal_error');
    }
  });

  it('DELETE-ответ с requests[].errors[] (v2_similar_request_still_processed) → CdekError', async () => {
    const request = vi.fn(async () => ({
      entity: { uuid: 'u-1' },
      requests: [
        {
          type: 'DELETE',
          state: 'INVALID',
          errors: [{ code: 'v2_similar_request_still_processed', message: 'processing' }],
        },
      ],
    }));
    await expect(stubRealService(request).cancel('u-1', false)).rejects.toMatchObject({
      name: 'CdekError',
    });
  });

  it('DELETE отклонён СДЭК → cancelShipment НЕ помечает отправление CANCELLED', async () => {
    repoState.shipment = { id: 'sh-1', orderId: 'ord-1', cdekUuid: 'u-1' };
    getShipmentMock.mockResolvedValue(repoState.shipment);
    getOrderByIdMock.mockResolvedValue({
      order: makeOrder({ deliveryStatus: 'pending' }),
      items: [makeItem()],
    });
    txState.deliveryStatus = 'pending';
    const request = vi.fn(async () => ({
      entity: { uuid: 'u-1' },
      requests: [
        { type: 'DELETE', state: 'INVALID', errors: [{ code: 'v2_entity_invalid', message: 'груз уже движется' }] },
      ],
    }));
    await expect(stubRealService(request).cancelShipment('ord-1')).rejects.toThrow();
    expect(updateShipmentMock).not.toHaveBeenCalled();
  });

  it('DELETE принят (ACCEPTED, без ошибок) → cancelShipment помечает CANCELLED', async () => {
    repoState.shipment = { id: 'sh-1', orderId: 'ord-1', cdekUuid: 'u-1' };
    getShipmentMock.mockResolvedValue(repoState.shipment);
    getOrderByIdMock.mockResolvedValue({
      order: makeOrder({ deliveryStatus: 'pending' }),
      items: [makeItem()],
    });
    txState.deliveryStatus = 'pending';
    txState.updateCount = 1;
    const request = vi.fn(async () => ({
      entity: { uuid: 'u-1' },
      requests: [{ type: 'DELETE', state: 'ACCEPTED' }],
    }));
    await expect(stubRealService(request).cancelShipment('ord-1')).resolves.toBeUndefined();
    const patch = updateShipmentMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.statusCode).toBe('CANCELLED');
  });
});
