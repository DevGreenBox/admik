"use client";

import { createContext, useContext } from "react";
import { DEFAULT_CURRENCY, formatPrice, type StorefrontCurrency } from "@/lib/format";

/**
 * Контекст валюты витрины (Находка-13). Серверный layout резолвит валюту из
 * settings.currency (`resolveCurrency`) и кладёт её сюда; клиентские компоненты
 * показа цены читают её через `useCurrency()` / `usePriceFormatter()` без
 * пробрасывания пропов через всё дерево. Дефолт — DEFAULT_CURRENCY (₽, ru-RU,
 * без копеек), поэтому компоненты вне провайдера ведут себя как раньше.
 *
 * Универсально для платформы: новый магазин меняет валюту настройкой в админке,
 * витрина начинает форматировать цены в его валюте без правки кода.
 */
const CurrencyContext = createContext<StorefrontCurrency>(DEFAULT_CURRENCY);

export function CurrencyProvider({
  currency,
  children,
}: {
  currency: StorefrontCurrency;
  children: React.ReactNode;
}) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>;
}

/** Текущая валюта витрины (из настроек магазина, фолбэк — дефолт витрины). */
export function useCurrency(): StorefrontCurrency {
  return useContext(CurrencyContext);
}

/** Форматтер цены, привязанный к валюте магазина. Замена прямого formatPrice в client-UI. */
export function usePriceFormatter(): (price: number) => string {
  const currency = useContext(CurrencyContext);
  return (price: number) => formatPrice(price, currency);
}
