"use client";

import { useState, useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CartItem, User, Order } from "@/types";

interface StoreState {
  cart: CartItem[];
  /** Slug-и товаров в избранном (UX-состояние, не бизнес-данные). */
  wishlist: string[];
  user: User | null;
  orders: Order[];
  /** Промокод, введённый в корзине — переносится в чекаут (Мадина: промокод в
   *  корзину). Применённость/скидку подтверждает сервер (quoteCart), это лишь ввод. */
  promoCode: string;

  addToCart: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  removeFromCart: (variantId: string) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  clearCart: () => void;
  setPromoCode: (code: string) => void;

  toggleWishlist: (slug: string) => void;
  isInWishlist: (slug: string) => boolean;

  setUser: (user: User | null) => void;
  addOrder: (order: Order) => void;
  /** Удаляет локально сохранённый заказ из ЛК по номеру (битый/протухший токен). */
  removeOrder: (number: string) => void;

  cartTotal: () => number;
  cartCount: () => number;
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      cart: [],
      wishlist: [],
      user: null,
      orders: [],
      promoCode: "",

      addToCart: (item, quantity = 1) => {
        set((state) => {
          const existing = state.cart.find(
            (i) => i.variantId === item.variantId
          );
          // Лимит остатка: cap по item.available (снимок). undefined → без лимита.
          const cap = item.available;
          const clamp = (q: number) =>
            cap === undefined ? q : Math.min(q, Math.max(0, cap));
          if (existing) {
            return {
              cart: state.cart.map((i) =>
                i.variantId === item.variantId
                  ? {
                      ...i,
                      available: cap ?? i.available,
                      quantity: clamp(i.quantity + quantity),
                    }
                  : i
              ),
            };
          }
          return { cart: [...state.cart, { ...item, quantity: clamp(quantity) }] };
        });
      },

      removeFromCart: (variantId) => {
        set((state) => ({
          cart: state.cart.filter((i) => i.variantId !== variantId),
        }));
      },

      updateQuantity: (variantId, quantity) => {
        if (quantity <= 0) {
          get().removeFromCart(variantId);
          return;
        }
        set((state) => ({
          cart: state.cart.map((i) =>
            i.variantId === variantId
              ? {
                  // Не даём превысить остаток (снимок available). undefined → без лимита.
                  ...i,
                  quantity:
                    i.available === undefined
                      ? quantity
                      : Math.min(quantity, Math.max(1, i.available)),
                }
              : i
          ),
        }));
      },

      clearCart: () => set({ cart: [], promoCode: "" }),
      setPromoCode: (code) => set({ promoCode: code }),

      toggleWishlist: (slug) => {
        set((state) => ({
          wishlist: state.wishlist.includes(slug)
            ? state.wishlist.filter((s) => s !== slug)
            : [...state.wishlist, slug],
        }));
      },

      isInWishlist: (slug) => get().wishlist.includes(slug),

      setUser: (user) => set({ user }),

      addOrder: (order) => set((state) => ({ orders: [order, ...state.orders] })),

      removeOrder: (number) =>
        set((state) => ({
          orders: state.orders.filter((o) => o.number !== number),
        })),

      cartTotal: () =>
        get().cart.reduce((sum, item) => sum + item.price * item.quantity, 0),

      cartCount: () => get().cart.reduce((sum, item) => sum + item.quantity, 0),
    }),
    {
      name: "the-case-store",
      skipHydration: true,
      partialize: (state) => ({
        cart: state.cart,
        wishlist: state.wishlist,
        orders: state.orders,
        promoCode: state.promoCode,
      }),
    }
  )
);

/**
 * True после завершения регидрации persist-хранилища (store создан со
 * skipHydration:true, регидрация запускается в Providers). Гейтит редиректы и
 * пустые состояния, чтобы они не срабатывали ДО восстановления корзины из
 * localStorage: иначе refresh/прямой заход на /checkout выкидывал на /cart, а
 * /cart и /wishlist мерцали «пусто» при наличии сохранённых данных.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);
  return hydrated;
}

export function selectCartCount(state: StoreState) {
  return state.cart.reduce((sum, item) => sum + item.quantity, 0);
}

/** Кол-во товаров в избранном (именованный селектор — единый паттерн, как cartCount). */
export function selectWishlistCount(state: StoreState) {
  return state.wishlist.length;
}

/** Удаляет slug-и из избранного (после ревалидации: товар скрыт/удалён → 404). */
export function pruneWishlist(removeSlugs: string[]): void {
  if (removeSlugs.length === 0) return;
  const drop = new Set(removeSlugs);
  useStore.setState((state) => ({
    wishlist: state.wishlist.filter((s) => !drop.has(s)),
  }));
}

export function selectCartTotal(state: StoreState) {
  return state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/**
 * Достигнут ли лимит остатка по позиции корзины (снимок `available`) — C24.
 * Чистый предикат для аффорданса кнопки «+» на /cart и (по желанию) карточке
 * товара. `available === undefined` → лимит неизвестен (старые записи) → false.
 */
export function isAtStockLimit(item: Pick<CartItem, "available" | "quantity">): boolean {
  return item.available != null && item.quantity >= item.available;
}
