"use client";

import { createContext, useContext } from "react";
import { CHECKOUT_MODE_DEFAULTS, type ResolvedCheckoutMode } from "@/lib/checkout-mode";

/**
 * Контекст режима оформления заказа (правки владельца 2026-07-22, п.5/п.7).
 *
 * Тот же приём, что у CurrencyProvider (Находка-13): серверный layout резолвит
 * настройку `checkout` из Admik и кладёт сюда, а клиентские страницы корзины и
 * чекаута читают её через `useCheckoutMode()` — без пробрасывания пропов и без
 * второго запроса настроек с клиента.
 *
 * Дефолт контекста = поведение витрины ДО настройки (оплата включена, упаковки
 * нет), поэтому компонент вне провайдера работает как раньше.
 */
const CheckoutModeContext = createContext<ResolvedCheckoutMode>(CHECKOUT_MODE_DEFAULTS);

export function CheckoutModeProvider({
  mode,
  children,
}: {
  mode: ResolvedCheckoutMode;
  children: React.ReactNode;
}) {
  return <CheckoutModeContext.Provider value={mode}>{children}</CheckoutModeContext.Provider>;
}

/** Режим оформления заказа магазина (оплата/подарочная упаковка). */
export function useCheckoutMode(): ResolvedCheckoutMode {
  return useContext(CheckoutModeContext);
}
