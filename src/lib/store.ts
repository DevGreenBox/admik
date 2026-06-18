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

  addToCart: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  removeFromCart: (variantId: string) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  clearCart: () => void;

  toggleWishlist: (slug: string) => void;
  isInWishlist: (slug: string) => boolean;

  setUser: (user: User | null) => void;
  addOrder: (order: Order) => void;

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

      addToCart: (item, quantity = 1) => {
        set((state) => {
          const existing = state.cart.find(
            (i) => i.variantId === item.variantId
          );
          if (existing) {
            return {
              cart: state.cart.map((i) =>
                i.variantId === item.variantId
                  ? { ...i, quantity: i.quantity + quantity }
                  : i
              ),
            };
          }
          return { cart: [...state.cart, { ...item, quantity }] };
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
            i.variantId === variantId ? { ...i, quantity } : i
          ),
        }));
      },

      clearCart: () => set({ cart: [] }),

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

export function selectCartTotal(state: StoreState) {
  return state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
