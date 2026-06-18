/**
 * Чистая логика чекаута THE CASE (без сети/React) — тестируется юнит-тестами
 * (checkout.test.ts). Сборка тела заказа/расчёта под Admik (variantId/qty),
 * форматирование срока доставки, валидация шагов.
 *
 * Источник истины по суммам — `cart/quote` (anti-tamper). Здесь только маппинг
 * выбора покупателя в контракт Admik (docs/13 §4, §5).
 */

import type { CartItem } from '@/types';
import type { AdmikCartLineInput } from '@/lib/admik';

/**
 * Позиции корзины → строки для quote/order. Товар без вариантов несёт productId
 * (тогда шлём его), иначе — variantId (товар с размерами). Admik принимает одно
 * из двух (ADR-010).
 */
export function cartToItems(cart: CartItem[]): AdmikCartLineInput[] {
  return cart.map((item) =>
    item.productId
      ? { productId: item.productId, qty: item.quantity }
      : { variantId: item.variantId, qty: item.quantity },
  );
}

/**
 * Срок доставки «N–M дней» / «N дней». Невалидные/нулевые границы → пусто.
 * При равных границах — одно число.
 */
export function formatEta(periodMin?: number, periodMax?: number): string {
  const min = Number.isFinite(periodMin) ? Number(periodMin) : 0;
  const max = Number.isFinite(periodMax) ? Number(periodMax) : 0;
  const lo = Math.max(0, Math.trunc(min));
  const hi = Math.max(0, Math.trunc(max));
  if (lo <= 0 && hi <= 0) return '';
  if (lo > 0 && hi > 0 && lo !== hi) return `${lo}–${hi} дней`;
  const d = hi > 0 ? hi : lo;
  return `${d} ${plural(d)}`;
}

/** Русское склонение слова «день» по числу. */
function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}

/** Контакты покупателя на шаге 1. */
export interface ContactForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/** Шаг 1 валиден: имя, email и телефон заполнены. */
export function isContactStepValid(form: ContactForm): boolean {
  return (
    form.firstName.trim() !== '' &&
    form.email.trim() !== '' &&
    form.phone.trim() !== ''
  );
}

/** Шаг 2 валиден: выбран город (cityCode) и ПВЗ (pvzCode). */
export function isDeliveryStepValid(
  cityCode: number | null,
  pvzCode: string | null,
): boolean {
  return cityCode !== null && Boolean(pvzCode);
}

/** Полное имя покупателя из формы (для customer.name заказа). */
export function fullName(form: Pick<ContactForm, 'firstName' | 'lastName'>): string {
  return `${form.firstName} ${form.lastName}`.trim();
}
