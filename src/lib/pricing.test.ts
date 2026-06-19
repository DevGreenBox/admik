import { describe, it, expect } from "vitest";
import { resolveSaleView, type SalePriceInput } from "@/lib/pricing";

function inp(over: Partial<SalePriceInput>): SalePriceInput {
  return {
    price: over.price ?? 1000,
    oldPrice: over.oldPrice,
    discountPct: over.discountPct ?? null,
    onSale: over.onSale ?? false,
  };
}

describe("resolveSaleView", () => {
  it("товар без скидки (onSale=false) → ничего не показываем", () => {
    const v = resolveSaleView(inp({ onSale: false, oldPrice: 2000, discountPct: 50 }));
    expect(v.onSale).toBe(false);
    expect(v.oldPrice).toBeNull();
    expect(v.discountPct).toBeNull();
    expect(v.badgeLabel).toBeNull();
  });

  it("onSale с валидной старой ценой и discountPct → бейдж из discountPct", () => {
    const v = resolveSaleView(inp({ price: 1500, oldPrice: 2000, discountPct: 25, onSale: true }));
    expect(v.onSale).toBe(true);
    expect(v.oldPrice).toBe(2000);
    expect(v.discountPct).toBe(25);
    expect(v.badgeLabel).toBe("−25%");
  });

  it("discountPct отсутствует → процент считается из (old−price)/old", () => {
    const v = resolveSaleView(inp({ price: 750, oldPrice: 1000, discountPct: null, onSale: true }));
    expect(v.discountPct).toBe(25);
    expect(v.badgeLabel).toBe("−25%");
  });

  it("процент округляется до целого", () => {
    // (1000−667)/1000 = 33.3% → 33
    const v = resolveSaleView(inp({ price: 667, oldPrice: 1000, discountPct: null, onSale: true }));
    expect(v.discountPct).toBe(33);
    expect(v.badgeLabel).toBe("−33%");
  });

  it("onSale, но старой цены нет → не показываем (защита от мусора)", () => {
    const v = resolveSaleView(inp({ price: 1000, oldPrice: undefined, discountPct: 10, onSale: true }));
    expect(v.onSale).toBe(false);
    expect(v.badgeLabel).toBeNull();
  });

  it("onSale, но старая цена не выше текущей → не показываем", () => {
    expect(resolveSaleView(inp({ price: 1000, oldPrice: 1000, onSale: true })).onSale).toBe(false);
    expect(resolveSaleView(inp({ price: 1000, oldPrice: 800, onSale: true })).onSale).toBe(false);
  });

  it("onSale с невалидным/нулевым процентом и без разницы цен → не показываем", () => {
    // старая равна текущей: рассчитанный процент 0 → скрываем
    const v = resolveSaleView(inp({ price: 1000, oldPrice: 1000, discountPct: 0, onSale: true }));
    expect(v.onSale).toBe(false);
  });

  it("отрицательный/NaN discountPct при валидной старой цене → считаем сами", () => {
    const v = resolveSaleView(inp({ price: 500, oldPrice: 1000, discountPct: -5, onSale: true }));
    expect(v.discountPct).toBe(50);
    expect(v.badgeLabel).toBe("−50%");
  });
});
