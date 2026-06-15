/**
 * Zod-схемы входа модуля orders (docs/07 §4) — единый источник правды о форме
 * входных данных. Переиспользуются в Server Actions админки (пакет 3.C) и в
 * Storefront API (пакет 3.D): quote/создание заказа/смена статуса/CRUD промокодов.
 *
 * Правила контракта (docs/07 §2, §3):
 *  - деньги — строка NUMERIC ≥ 0 (точность не теряем, валидируем формат);
 *  - qty (количество) — целое ≥ 1;
 *  - id — uuid; статусы/типы — литералы из CHECK-ограничений БД (см. types.ts).
 *
 * Anti-tamper (ADR-010): витрине доверяем только variantId/productId + qty +
 *  выборы (доставка/промокод). Цены/итог считает сервер — поэтому в схемах
 *  создания заказа/quote НЕТ полей цены: они игнорируются по дизайну.
 */

import { z } from 'zod';

import {
  DELIVERY_STATUSES,
  DELIVERY_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PROMO_KINDS,
} from './types';

// -----------------------------------------------------------------------------
// Переиспользуемые примитивы.
// -----------------------------------------------------------------------------

/** UUID-идентификатор. */
export const uuidSchema = z.string().uuid();

/**
 * Денежная сумма NUMERIC(14,2) ≥ 0 как строка (как в каталоге).
 * Принимает целое/дробное (до 2 знаков), без минуса; целая часть ≤ 12 цифр.
 */
export const moneySchema = z
  .string()
  .trim()
  .regex(
    /^\d{1,12}(?:\.\d{1,2})?$/,
    'сумма: неотрицательное число с не более чем 2 знаками после точки',
  );

/** Количество единиц позиции: целое ≥ 1. */
export const quantitySchema = z.number().int().min(1);

/** Промокод (citext в БД): непустой, без пробелов по краям, до 64 символов. */
export const promoCodeSchema = z.string().trim().min(1).max(64);

/** Контакты покупателя (гостевой чекаут — хранятся в заказе). */
export const customerContactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email(),
  phone: z.string().trim().min(1).max(40),
});

/**
 * Выбор доставки на входе (anti-tamper: стоимость считает сервер, её здесь нет).
 * pvzCode обязателен только для type='pvz' (проверяется .superRefine ниже).
 */
export const deliverySelectionSchema = z
  .object({
    type: z.enum(DELIVERY_TYPES),
    city: z.string().trim().max(200).optional(),
    address: z.string().trim().max(500).optional(),
    pvzCode: z.string().trim().max(64).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'pvz' && !val.pvzCode) {
      ctx.addIssue({
        code: 'custom',
        path: ['pvzCode'],
        message: 'Для доставки в ПВЗ требуется код пункта выдачи (pvzCode).',
      });
    }
  });

/**
 * Позиция корзины на входе. Должен быть указан хотя бы один из variantId/productId
 * (variantId приоритетен). Цена НЕ принимается — сервер берёт её из каталога.
 */
export const cartLineSchema = z
  .object({
    variantId: uuidSchema.optional(),
    productId: uuidSchema.optional(),
    qty: quantitySchema,
  })
  .refine((v) => Boolean(v.variantId) || Boolean(v.productId), {
    message: 'Нужен variantId или productId.',
    path: ['variantId'],
  });

// -----------------------------------------------------------------------------
// quote — серверный расчёт корзины (POST /cart/quote, §4.2). Ничего не создаёт.
// -----------------------------------------------------------------------------

export const CartQuoteSchema = z.object({
  items: z.array(cartLineSchema).min(1, 'Корзина пуста.'),
  promoCode: promoCodeSchema.optional(),
  delivery: deliverySelectionSchema.optional(),
});
export type CartQuoteInput = z.infer<typeof CartQuoteSchema>;

// -----------------------------------------------------------------------------
// Создание заказа (POST /orders, §4.2). Идемпотентность — Idempotency-Key (header).
// -----------------------------------------------------------------------------

export const CreateOrderSchema = z.object({
  items: z.array(cartLineSchema).min(1, 'Корзина пуста.'),
  customer: customerContactSchema,
  delivery: deliverySelectionSchema,
  paymentMethod: z.enum(PAYMENT_METHODS),
  promoCode: promoCodeSchema.optional(),
  comment: z.string().trim().max(2000).optional(),
  /** Ключ идемпотентности (обычно из заголовка Idempotency-Key). */
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

/** Ручное создание заказа в админке (source='admin'): та же форма + признак. */
export const ManualOrderSchema = CreateOrderSchema.extend({
  source: z.literal('admin').optional(),
});
export type ManualOrderInput = z.infer<typeof ManualOrderSchema>;

// -----------------------------------------------------------------------------
// Смена статусов (Server Actions §4.1; каждая пишет историю + audit).
// -----------------------------------------------------------------------------

export const ChangeOrderStatusSchema = z.object({
  id: uuidSchema,
  to: z.enum(ORDER_STATUSES),
  comment: z.string().trim().max(2000).optional(),
});
export type ChangeOrderStatusInput = z.infer<typeof ChangeOrderStatusSchema>;

export const SetPaymentStatusSchema = z.object({
  id: uuidSchema,
  to: z.enum(PAYMENT_STATUSES),
  comment: z.string().trim().max(2000).optional(),
});
export type SetPaymentStatusInput = z.infer<typeof SetPaymentStatusSchema>;

export const SetDeliveryStatusSchema = z.object({
  id: uuidSchema,
  to: z.enum(DELIVERY_STATUSES),
  comment: z.string().trim().max(2000).optional(),
});
export type SetDeliveryStatusInput = z.infer<typeof SetDeliveryStatusSchema>;

// -----------------------------------------------------------------------------
// Промокоды — CRUD (Server Actions §4.1, право orders.write).
// -----------------------------------------------------------------------------

const promoBaseShape = {
  code: promoCodeSchema,
  kind: z.enum(PROMO_KINDS),
  value: moneySchema.optional().default('0'),
  minOrderTotal: moneySchema.optional().default('0'),
  maxDiscount: moneySchema.nullish(),
  usageLimit: z.number().int().min(0).nullish(),
  perCustomerLimit: z.number().int().min(0).nullish(),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  isActive: z.boolean().optional().default(true),
  bogoBuyQty: z.number().int().min(1).nullish(),
  bogoPayQty: z.number().int().min(1).nullish(),
  comment: z.string().trim().max(2000).optional().default(''),
};

/**
 * Общая семантическая проверка промокода:
 *  - percent: value в диапазоне 0..100;
 *  - даты: ends_at ≥ starts_at (если обе заданы);
 *  - bogo: pay_qty < buy_qty (если оба заданы).
 */
function refinePromo(
  val: {
    kind?: string;
    value?: string;
    startsAt?: Date | null;
    endsAt?: Date | null;
    bogoBuyQty?: number | null;
    bogoPayQty?: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (val.kind === 'percent' && val.value !== undefined) {
    const pct = Number(val.value);
    if (pct > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Для percent value должно быть в диапазоне 0..100.',
      });
    }
  }
  if (val.startsAt && val.endsAt && val.endsAt < val.startsAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'Дата окончания не может быть раньше даты начала.',
    });
  }
  if (
    typeof val.bogoBuyQty === 'number' &&
    typeof val.bogoPayQty === 'number' &&
    val.bogoPayQty >= val.bogoBuyQty
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['bogoPayQty'],
      message: 'Для bogo «плати за M» должно быть меньше «купи N».',
    });
  }
}

export const PromoCreateSchema = z.object(promoBaseShape).superRefine(refinePromo);
export type PromoCreateInput = z.infer<typeof PromoCreateSchema>;

export const PromoUpdateSchema = z
  .object({ id: uuidSchema, ...promoBaseShape })
  .partial({
    code: true,
    kind: true,
    value: true,
    minOrderTotal: true,
    isActive: true,
    comment: true,
  })
  .superRefine(refinePromo);
export type PromoUpdateInput = z.infer<typeof PromoUpdateSchema>;

export const PromoIdSchema = z.object({ id: uuidSchema });
export type PromoIdInput = z.infer<typeof PromoIdSchema>;
