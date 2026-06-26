import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/lib/store";
import type { Order } from "@/types";

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
