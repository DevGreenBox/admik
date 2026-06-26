import { describe, it, expect, beforeEach } from "vitest";
import { useStore, isAtStockLimit } from "@/lib/store";
import type { CartItem, Order } from "@/types";

const order = (over: Partial<Order> = {}): Order => ({
  number: "A1",
  accessToken: "tok-1",
  createdAt: "2026-06-25T00:00:00.000Z",
  ...over,
});

describe("store.removeOrder (#28)", () => {
  beforeEach(() => {
    useStore.setState({ orders: [] });
  });

  it("удаляет заказ по number, остальные сохраняет", () => {
    useStore.getState().addOrder(order({ number: "A" }));
    useStore.getState().addOrder(order({ number: "B" }));
    // addOrder добавляет в начало → [B, A]
    useStore.getState().removeOrder("A");
    expect(useStore.getState().orders.map((o) => o.number)).toEqual(["B"]);
  });

  it("неизвестный number — список не меняется (идемпотентно)", () => {
    useStore.getState().addOrder(order({ number: "A" }));
    useStore.getState().removeOrder("X");
    expect(useStore.getState().orders.map((o) => o.number)).toEqual(["A"]);
  });

  it("удаление до пустого списка", () => {
    useStore.getState().addOrder(order({ number: "A" }));
    useStore.getState().removeOrder("A");
    expect(useStore.getState().orders).toEqual([]);
  });
});

const cartItem = (over: Partial<CartItem> = {}): Omit<CartItem, "quantity"> => ({
  variantId: "v1",
  slug: "halat",
  name: "Халат",
  size: "M",
  price: 4900,
  imageUrl: null,
  ...over,
});

describe("isAtStockLimit (C24)", () => {
  it("available=3, quantity=3 → true (достигнут лимит)", () => {
    expect(isAtStockLimit({ available: 3, quantity: 3 })).toBe(true);
  });
  it("available=3, quantity=2 → false", () => {
    expect(isAtStockLimit({ available: 3, quantity: 2 })).toBe(false);
  });
  it("available=undefined → false (старые записи без лимита)", () => {
    expect(isAtStockLimit({ available: undefined, quantity: 99 })).toBe(false);
  });
  it("quantity > available → true (граница)", () => {
    expect(isAtStockLimit({ available: 3, quantity: 5 })).toBe(true);
  });
});

describe("store.updateQuantity — зажим по остатку (C24)", () => {
  beforeEach(() => {
    useStore.setState({ cart: [] });
  });

  it("не даёт превысить available (5 → зажато до 3)", () => {
    useStore.getState().addToCart(cartItem({ available: 3 }));
    useStore.getState().updateQuantity("v1", 5);
    expect(useStore.getState().cart[0].quantity).toBe(3);
  });

  it("quantity 0 → позиция удаляется", () => {
    useStore.getState().addToCart(cartItem({ available: 3 }));
    useStore.getState().updateQuantity("v1", 0);
    expect(useStore.getState().cart).toEqual([]);
  });
});
