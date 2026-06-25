/**
 * Форматирование значений для UI витрины THE CASE.
 *
 * `formatPrice` — единая точка форматирования цены. По умолчанию (без явной
 * валюты) поведение прежнее: ₽, ru-RU, копейки скрыты — чтобы существующие
 * вызовы и витрины-фолбэки не менялись. Когда владелец задал валюту в админке
 * Admik (settings.currency), значения пробрасываются вторым аргументом
 * (`StorefrontCurrency`) и форматирование подчиняется коду/локали/символу/
 * числу знаков после запятой. Универсально для любого ИМ платформы (G-01).
 *
 * Перенесено из устаревшего `src/lib/products.ts` (Wave B).
 */

/** Разрешённый формат валюты витрины (резолвится из settings.currency). */
export interface StorefrontCurrency {
  /** ISO-код валюты (RUB/USD/EUR/KZT…). */
  code: string;
  /** BCP 47 локаль форматирования (ru-RU/en-US…). */
  locale: string;
  /** Кастомный символ (₽/$/₸…); null → символ из локали/кода Intl. */
  symbol: string | null;
  /** Число знаков после запятой (0 → без копеек). */
  fractionDigits: number;
}

/** Дефолт витрины — точная копия прежнего хардкода (фолбэк до правки в админке). */
export const DEFAULT_CURRENCY: StorefrontCurrency = {
  code: "RUB",
  locale: "ru-RU",
  symbol: null,
  fractionDigits: 0,
};

/**
 * Форматирует цену. Без `currency` — прежнее поведение (₽, ru-RU, без копеек).
 * С `currency` — по настройкам магазина. При невалидном коде/локали падает на
 * дефолт витрины, чтобы кривая настройка не роняла рендер цены.
 */
export function formatPrice(price: number, currency: StorefrontCurrency = DEFAULT_CURRENCY): string {
  const c = currency;
  try {
    const formatted = new Intl.NumberFormat(c.locale, {
      style: "currency",
      currency: c.code,
      maximumFractionDigits: c.fractionDigits,
      minimumFractionDigits: c.fractionDigits,
    }).format(price);

    // Кастомный символ владельца (если задан) замещает символ из Intl, не трогая
    // расположение/группировку чисел конкретной локали.
    if (c.symbol && c.symbol.trim().length > 0) {
      return replaceCurrencySymbol(c.locale, c.code, c.fractionDigits, price, formatted, c.symbol.trim());
    }
    return formatted;
  } catch {
    // Невалидный код/локаль → дефолт витрины (₽, ru-RU, без копеек).
    return new Intl.NumberFormat(DEFAULT_CURRENCY.locale, {
      style: "currency",
      currency: DEFAULT_CURRENCY.code,
      maximumFractionDigits: DEFAULT_CURRENCY.fractionDigits,
    }).format(price);
  }
}

/**
 * Подставляет пользовательский символ вместо дефолтного символа валюты. Берём
 * символ, который Intl сам подставил для (locale, code), и заменяем его на
 * кастомный — так сохраняем позицию символа и разделители конкретной локали.
 */
function replaceCurrencySymbol(
  locale: string,
  code: string,
  fractionDigits: number,
  price: number,
  formatted: string,
  symbol: string,
): string {
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).formatToParts(price);
  const intlSymbol = parts.find((p) => p.type === "currency")?.value;
  if (!intlSymbol) return formatted;
  return formatted.replace(intlSymbol, symbol);
}
