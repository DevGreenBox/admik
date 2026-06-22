"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";

/**
 * Тонкий клиентский провайдер: только гидрация zustand-store (cart/wishlist/orders
 * из localStorage). Покупательских серверных сессий у витрины нет — заказы создаются
 * в Admik и читаются по accessToken (см. docs/13 §1).
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    useStore.persist.rehydrate();
  }, []);

  return <>{children}</>;
}
