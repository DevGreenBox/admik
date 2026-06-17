import { describe, it, expect } from 'vitest';
import { buildReceipt, receiptTotalKop, toKopecks } from '@/lib/payments/tbank/receipt';
import { getTbankConfig } from '@/lib/payments/tbank/config';
import type { Order, OrderItem } from '@/lib/orders/types';

/**
 * Юнит-тесты сборки чека 54-ФЗ (docs/15 §6). ЧИСТЫЕ, без сети/БД. КЛЮЧЕВОЙ
 * инвариант: сумма Items.Amount = Init.Amount (иначе Т-Банк отклонит).
 */

function order(extra: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    number: '2026-000123',
    status: 'awaiting_payment',
    itemsTotal: '1500.00',
    discountTotal: '0.00',
    deliveryTotal: '0.00',
    grandTotal: '1500.00',
    currency: 'RUB',
    paymentMethod: 'card',
    paymentStatus: 'pending',
    paidAt: null,
    paymentRef: null,
    deliveryType: 'pvz',
    deliveryStatus: 'pending',
    deliveryCity: null,
    deliveryAddress: null,
    deliveryPvzCode: null,
    deliveryCost: null,
    cdekUuid: null,
    cdekTrack: null,
    promoCodeId: null,
    promoCode: null,
    customerId: null,
    customerName: 'Иван',
    customerEmail: 'buyer@example.com',
    customerPhone: '+79991234567',
    comment: '',
    idempotencyKey: null,
    source: 'storefront',
    ip: null,
    createdAt: new Date('2026-06-16T10:00:00Z'),
    updatedAt: new Date('2026-06-16T10:00:00Z'),
    ...extra,
  };
}

function item(extra: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'i1',
    orderId: 'o1',
    productId: null,
    variantId: null,
    nameSnapshot: 'Товар',
    skuSnapshot: 'SKU-1',
    attributesSnapshot: {},
    unitPrice: '500.00',
    compareAtSnapshot: null,
    quantity: 3,
    lineTotal: '1500.00',
    isGift: false,
    weightG: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    createdAt: new Date('2026-06-16T10:00:00Z'),
    ...extra,
  };
}

const CFG_WITH_TAX = getTbankConfig({
  NODE_ENV: 'test',
  TBANK_TAXATION: 'usn_income',
  TBANK_DEFAULT_TAX: 'none',
});

describe('tbank/receipt — toKopecks', () => {
  it('рубли-строка NUMERIC → целые копейки', () => {
    expect(toKopecks('1500.00')).toBe(150000);
    expect(toKopecks('19.99')).toBe(1999);
    expect(toKopecks('0.00')).toBe(0);
    expect(toKopecks(100)).toBe(10000);
  });
});

describe('tbank/receipt — buildReceipt инвариант суммы', () => {
  it('сумма Items.Amount = grand_total в копейках (без доставки)', () => {
    const o = order();
    const r = buildReceipt(o, [item()], CFG_WITH_TAX)!;
    expect(r).not.toBeNull();
    expect(receiptTotalKop(r)).toBe(toKopecks(o.grandTotal));
    expect(r.Items).toHaveLength(1);
    expect(r.Items[0]!.Price).toBe(50000);
    expect(r.Items[0]!.Amount).toBe(150000);
    expect(r.Taxation).toBe('usn_income');
  });

  it('доставка (>0) добавляется отдельной позицией service; сумма сходится', () => {
    const o = order({ deliveryTotal: '300.00', grandTotal: '1800.00' });
    const r = buildReceipt(o, [item()], CFG_WITH_TAX)!;
    expect(r.Items).toHaveLength(2);
    const delivery = r.Items[1]!;
    expect(delivery.Name).toBe('Доставка');
    expect(delivery.PaymentObject).toBe('service');
    expect(delivery.Amount).toBe(30000);
    expect(receiptTotalKop(r)).toBe(toKopecks(o.grandTotal));
  });

  it('Email/Phone из заказа', () => {
    const r = buildReceipt(order(), [item()], CFG_WITH_TAX)!;
    expect(r.Email).toBe('buyer@example.com');
    expect(r.Phone).toBe('+79991234567');
  });
});

describe('tbank/receipt — buildReceipt отказы', () => {
  it('без taxation в конфиге → null (чек невозможен)', () => {
    const cfg = getTbankConfig({ NODE_ENV: 'test' }); // taxation пуст
    expect(buildReceipt(order(), [item()], cfg)).toBeNull();
  });

  it('без email и телефона → null', () => {
    const o = order({ customerEmail: '', customerPhone: '' });
    expect(buildReceipt(o, [item()], CFG_WITH_TAX)).toBeNull();
  });
});
