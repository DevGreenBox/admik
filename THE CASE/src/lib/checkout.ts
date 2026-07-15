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

/** Грубая проверка формата email — ранний клиентский гейт, чтобы кнопка «Далее»
 *  блокировалась при явно невалидном email (сервер валидирует строго, но его
 *  ошибка прилетела бы только на последнем шаге). */
export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}

/** Шаг 1 валиден: имя и телефон заполнены, email корректного формата. */
export function isContactStepValid(form: ContactForm): boolean {
  return (
    form.firstName.trim() !== '' &&
    isValidEmail(form.email) &&
    isValidRuPhone(form.phone)
  );
}

/**
 * Маска телефона РФ (правка Ани2 #8: «нельзя ввести больше 11 цифр»). Оставляет
 * только цифры, нормализует ведущую 8→7, ограничивает 11 цифрами и форматирует
 * как «+7 (900) 123-45-67». Частичный ввод форматируется прогрессивно (не мешает
 * набору). Чистая — покрыта юнит-тестами.
 */
export function formatRuPhone(raw: string): string {
  let digits = (raw.match(/\d/g) || []).join('');
  // ведущая 8 или 7 — это код страны; нормализуем к 7
  if (digits.startsWith('8')) digits = '7' + digits.slice(1);
  if (!digits.startsWith('7')) digits = '7' + digits;
  digits = digits.slice(0, 11); // максимум 11 цифр (7 + 10)
  const d = digits.slice(1); // 10 цифр номера
  let out = '+7';
  if (d.length > 0) out += ' (' + d.slice(0, 3);
  if (d.length >= 3) out += ')';
  if (d.length > 3) out += ' ' + d.slice(3, 6);
  if (d.length > 6) out += '-' + d.slice(6, 8);
  if (d.length > 8) out += '-' + d.slice(8, 10);
  return out;
}

/** Телефон валиден: ровно 11 цифр (РФ: 7 + 10). */
export function isValidRuPhone(phone: string): boolean {
  return (phone.match(/\d/g) || []).length === 11;
}

/** Поля шага 1 с ошибками (для подсветки — правка Ани2 #7: показать, где не так). */
export function contactFieldErrors(form: ContactForm): Record<keyof ContactForm, boolean> {
  return {
    firstName: form.firstName.trim() === '',
    lastName: false, // фамилия необязательна
    email: !isValidEmail(form.email),
    phone: !isValidRuPhone(form.phone),
  };
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

/**
 * Отображение стоимости доставки на шаге 2 чекаута (m11).
 *
 * «Уточняется» — когда доставка недоступна (расчёт СДЭК soft-fail, available=false)
 * ИЛИ стоимость ещё не известна (cost=null): нельзя обещать «Бесплатно» за непосчитанную
 * доставку. Раньше шаг 2 показывал «Бесплатно» при cost===0, ИГНОРИРУЯ доступность —
 * хотя шаг 3 уже корректно показывал «Уточняется» (рассинхрон, вводил покупателя в
 * заблуждение). «Бесплатно» — только при реально нулевой И доступной стоимости.
 * `format` инъектируется (formatPrice) — модуль остаётся чистым/без React/сети.
 */
export function formatDeliveryCost(
  cost: number | null,
  available: boolean,
  format: (n: number) => string,
): string {
  if (!available || cost === null) return 'Уточняется';
  return cost === 0 ? 'Бесплатно' : format(cost);
}

/**
 * RU-подпись причины недоступности позиции по коду `quote.issues[].code` (C25).
 * Дженерик, без привязки к магазину. Неизвестный код → нейтральный fallback
 * (forward-compat контракта: новый код бэкенда не уронит отображение).
 */
export function issueReasonLabel(code: string): string {
  switch (code) {
    case 'out_of_stock':
      return 'Нет в наличии';
    case 'inactive':
      return 'Снят с продажи';
    case 'product_not_found':
    case 'variant_not_found':
      return 'Товар недоступен';
    default:
      return 'Недоступно к заказу';
  }
}

/** Описание недоступной позиции для показа на чекауте. */
export interface QuoteIssueDescription {
  name: string;
  reason: string;
}

/**
 * Сопоставляет `quote.issues[]` (index в `cart` + код) человекочитаемым именам и
 * причинам (C25). `index` адресует `cart[index]` 1:1 (cartToItems сохраняет
 * порядок). Пустое имя/индекс вне диапазона → fallback «Позиция N».
 */
export function describeQuoteIssues(
  issues: Array<{ index: number; code: string }>,
  cart: CartItem[],
): QuoteIssueDescription[] {
  return issues.map((issue) => {
    const item = cart[issue.index];
    const name = item?.name?.trim() ? item.name : `Позиция ${issue.index + 1}`;
    return { name, reason: issueReasonLabel(issue.code) };
  });
}
