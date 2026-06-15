import { describe, expect, it } from 'vitest';

import {
  CartQuoteSchema,
  ChangeOrderStatusSchema,
  CreateOrderSchema,
  PromoCreateSchema,
  PromoUpdateSchema,
  SetDeliveryStatusSchema,
  SetPaymentStatusSchema,
  cartLineSchema,
  moneySchema,
  quantitySchema,
} from '@/lib/orders/schemas';

/**
 * Тесты Zod-схем модуля orders (docs/07 §4) — всегда зелёные (без БД).
 * Покрывают валидные/невалидные кейсы quote/создания заказа/смены статуса/CRUD
 * промокодов; валидацию денег (≥0) и количества (≥1).
 */

const UUID = '11111111-1111-4111-8111-111111111111';

describe('orders/schemas — примитивы', () => {
  it('moneySchema принимает неотрицательные суммы ≤ 2 знаков', () => {
    expect(moneySchema.safeParse('0').success).toBe(true);
    expect(moneySchema.safeParse('100').success).toBe(true);
    expect(moneySchema.safeParse('100.50').success).toBe(true);
  });

  it('moneySchema отклоняет минус, 3 знака, мусор', () => {
    expect(moneySchema.safeParse('-1').success).toBe(false);
    expect(moneySchema.safeParse('1.234').success).toBe(false);
    expect(moneySchema.safeParse('abc').success).toBe(false);
  });

  it('quantitySchema требует целое ≥ 1', () => {
    expect(quantitySchema.safeParse(1).success).toBe(true);
    expect(quantitySchema.safeParse(0).success).toBe(false);
    expect(quantitySchema.safeParse(-3).success).toBe(false);
    expect(quantitySchema.safeParse(1.5).success).toBe(false);
  });

  it('cartLineSchema требует variantId или productId', () => {
    expect(cartLineSchema.safeParse({ variantId: UUID, qty: 2 }).success).toBe(true);
    expect(cartLineSchema.safeParse({ productId: UUID, qty: 1 }).success).toBe(true);
    expect(cartLineSchema.safeParse({ qty: 1 }).success).toBe(false);
  });

  it('cartLineSchema НЕ принимает цену из тела (anti-tamper)', () => {
    const parsed = cartLineSchema.parse({ variantId: UUID, qty: 1, unitPrice: '0.01' } as never);
    expect('unitPrice' in (parsed as Record<string, unknown>)).toBe(false);
  });
});

describe('orders/schemas — CartQuoteSchema (POST /cart/quote)', () => {
  it('принимает корзину с позициями и опц. промокодом/доставкой', () => {
    const res = CartQuoteSchema.safeParse({
      items: [{ variantId: UUID, qty: 2 }],
      promoCode: 'SALE10',
      delivery: { type: 'courier', city: 'Москва' },
    });
    expect(res.success).toBe(true);
  });

  it('отклоняет пустую корзину', () => {
    expect(CartQuoteSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it('доставка в ПВЗ требует pvzCode', () => {
    expect(
      CartQuoteSchema.safeParse({
        items: [{ variantId: UUID, qty: 1 }],
        delivery: { type: 'pvz', city: 'Москва' },
      }).success,
    ).toBe(false);
    expect(
      CartQuoteSchema.safeParse({
        items: [{ variantId: UUID, qty: 1 }],
        delivery: { type: 'pvz', city: 'Москва', pvzCode: 'MSK1' },
      }).success,
    ).toBe(true);
  });
});

describe('orders/schemas — CreateOrderSchema (POST /orders)', () => {
  const base = {
    items: [{ variantId: UUID, qty: 1 }],
    customer: { name: 'Иван', email: 'ivan@example.com', phone: '+79990000000' },
    delivery: { type: 'courier', city: 'Москва', address: 'ул. 1' },
    paymentMethod: 'cod',
  };

  it('принимает валидный заказ', () => {
    expect(CreateOrderSchema.safeParse(base).success).toBe(true);
  });

  it('отклоняет невалидный email покупателя', () => {
    expect(
      CreateOrderSchema.safeParse({ ...base, customer: { ...base.customer, email: 'не-email' } })
        .success,
    ).toBe(false);
  });

  it('отклоняет неизвестный способ оплаты', () => {
    expect(CreateOrderSchema.safeParse({ ...base, paymentMethod: 'bitcoin' }).success).toBe(false);
  });

  it('принимает опц. idempotencyKey', () => {
    const res = CreateOrderSchema.safeParse({ ...base, idempotencyKey: 'idem-123' });
    expect(res.success).toBe(true);
  });
});

describe('orders/schemas — смена статусов', () => {
  it('ChangeOrderStatusSchema принимает валидный целевой статус', () => {
    expect(ChangeOrderStatusSchema.safeParse({ id: UUID, to: 'paid' }).success).toBe(true);
    expect(ChangeOrderStatusSchema.safeParse({ id: UUID, to: 'bogus' }).success).toBe(false);
  });

  it('SetPaymentStatusSchema/ SetDeliveryStatusSchema ограничены своими литералами', () => {
    expect(SetPaymentStatusSchema.safeParse({ id: UUID, to: 'paid' }).success).toBe(true);
    expect(SetPaymentStatusSchema.safeParse({ id: UUID, to: 'shipped' }).success).toBe(false);
    expect(SetDeliveryStatusSchema.safeParse({ id: UUID, to: 'in_transit' }).success).toBe(true);
    expect(SetDeliveryStatusSchema.safeParse({ id: UUID, to: 'paid' }).success).toBe(false);
  });

  it('требует валидный uuid', () => {
    expect(ChangeOrderStatusSchema.safeParse({ id: 'not-uuid', to: 'paid' }).success).toBe(false);
  });
});

describe('orders/schemas — промокоды CRUD', () => {
  it('PromoCreateSchema принимает корректный percent-промокод', () => {
    const res = PromoCreateSchema.safeParse({
      code: 'SALE10',
      kind: 'percent',
      value: '10',
      minOrderTotal: '1000',
    });
    expect(res.success).toBe(true);
  });

  it('percent > 100 отклоняется', () => {
    expect(
      PromoCreateSchema.safeParse({ code: 'X', kind: 'percent', value: '150' }).success,
    ).toBe(false);
  });

  it('отрицательные суммы отклоняются (money ≥ 0)', () => {
    expect(
      PromoCreateSchema.safeParse({ code: 'X', kind: 'fixed', value: '-5' }).success,
    ).toBe(false);
  });

  it('неизвестный kind отклоняется', () => {
    expect(PromoCreateSchema.safeParse({ code: 'X', kind: 'mystery' }).success).toBe(false);
  });

  it('ends_at раньше starts_at отклоняется', () => {
    expect(
      PromoCreateSchema.safeParse({
        code: 'X',
        kind: 'fixed',
        value: '100',
        startsAt: '2026-02-01',
        endsAt: '2026-01-01',
      }).success,
    ).toBe(false);
  });

  it('bogo pay_qty ≥ buy_qty отклоняется', () => {
    expect(
      PromoCreateSchema.safeParse({
        code: 'X',
        kind: 'bogo',
        bogoBuyQty: 2,
        bogoPayQty: 2,
      }).success,
    ).toBe(false);
    expect(
      PromoCreateSchema.safeParse({
        code: '3FOR2',
        kind: 'bogo',
        bogoBuyQty: 3,
        bogoPayQty: 2,
      }).success,
    ).toBe(true);
  });

  it('PromoUpdateSchema требует id и допускает частичное обновление', () => {
    expect(PromoUpdateSchema.safeParse({ id: UUID, isActive: false }).success).toBe(true);
    expect(PromoUpdateSchema.safeParse({ isActive: false }).success).toBe(false);
  });

  it('дефолты PromoCreateSchema: value=0, minOrderTotal=0, isActive=true', () => {
    const parsed = PromoCreateSchema.parse({ code: 'FD', kind: 'free_delivery' });
    expect(parsed.value).toBe('0');
    expect(parsed.minOrderTotal).toBe('0');
    expect(parsed.isActive).toBe(true);
    expect(parsed.comment).toBe('');
  });
});
