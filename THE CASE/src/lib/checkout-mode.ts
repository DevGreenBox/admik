import type { AdmikSettingsDto } from './admik';

/**
 * Режим оформления заказа на витрине (настройка Admik `checkout`).
 *
 * Клиентский модуль без зависимостей от сети/react — чистая функция, поэтому
 * его можно импортировать и в серверных компонентах, и в 'use client'
 * (см. «Ловушка сборки» в CLAUDE.md: клиентский компонент не должен тянуть
 * модули с доступом к БД).
 *
 * Закрывает две правки владельца 2026-07-22:
 *   • п.7 — пока у магазина нет кассы, витрина не отправляет покупателя на
 *     эквайринг, а принимает ЗАЯВКУ и обещает связаться;
 *   • п.5 — пункт «подарочная упаковка» в корзине.
 */
export interface ResolvedCheckoutMode {
  /** Инициировать ли онлайн-оплату после создания заказа. */
  onlinePaymentEnabled: boolean;
  /** Что показать покупателю вместо выбора способа оплаты. Всегда непустой. */
  paymentDisabledNotice: string;
  giftWrapEnabled: boolean;
  /** Подпись галочки в корзине. Всегда непустая. */
  giftWrapLabel: string;
}

/**
 * Дефолты витрины = поведение ДО появления настройки.
 *
 * Оплата включена намеренно: если настройки не доехали (сбой API/таймаут),
 * магазин с работающей кассой не должен молча перестать принимать платежи.
 * Упаковка выключена — услуги раньше не существовало.
 */
export const CHECKOUT_MODE_DEFAULTS: ResolvedCheckoutMode = {
  onlinePaymentEnabled: true,
  paymentDisabledNotice:
    'Онлайн-оплата на сайте временно недоступна. Оставьте заказ — мы свяжемся с вами и подтвердим детали.',
  giftWrapEnabled: false,
  giftWrapLabel: 'Упаковать в подарочную упаковку',
};

/** Строка настроек → значение или undefined (пустая строка = «не задано»). */
function text(v: string | null | undefined): string | undefined {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length > 0 ? t : undefined;
}

/**
 * Булево настроек → значение или undefined. null (незаполненное поле бэкенда)
 * трактуется как «не задано», а НЕ как false: иначе пустая настройка выключала
 * бы оплату сама собой.
 */
function flag(v: boolean | null | undefined): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

export function resolveCheckoutMode(s: AdmikSettingsDto | null): ResolvedCheckoutMode {
  const c = s?.checkout ?? null;
  return {
    onlinePaymentEnabled:
      flag(c?.onlinePaymentEnabled) ?? CHECKOUT_MODE_DEFAULTS.onlinePaymentEnabled,
    paymentDisabledNotice:
      text(c?.paymentDisabledNotice) ?? CHECKOUT_MODE_DEFAULTS.paymentDisabledNotice,
    giftWrapEnabled: flag(c?.giftWrapEnabled) ?? CHECKOUT_MODE_DEFAULTS.giftWrapEnabled,
    giftWrapLabel: text(c?.giftWrapLabel) ?? CHECKOUT_MODE_DEFAULTS.giftWrapLabel,
  };
}
