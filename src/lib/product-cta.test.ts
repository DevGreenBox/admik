import { describe, it, expect } from "vitest";
import { productCtaLabel, type ProductCtaState } from "@/lib/product-cta";

function st(over: Partial<ProductCtaState>): ProductCtaState {
  return {
    added: over.added ?? false,
    hasVariants: over.hasVariants ?? false,
    canBuySimple: over.canBuySimple ?? false,
    hasAvailableVariants: over.hasAvailableVariants ?? false,
    hasSelectedVariant: over.hasSelectedVariant ?? false,
  };
}

describe("productCtaLabel", () => {
  it("после добавления показывает «Добавлено» (приоритет над остальным)", () => {
    expect(productCtaLabel(st({ added: true, canBuySimple: true }))).toBe("Добавлено");
    expect(
      productCtaLabel(st({ added: true, hasVariants: true, hasAvailableVariants: true, hasSelectedVariant: true })),
    ).toBe("Добавлено");
  });

  it("простой товар (без вариантов) в наличии → «В корзину»", () => {
    expect(productCtaLabel(st({ canBuySimple: true }))).toBe("В корзину");
  });

  it("простой товар (без вариантов) не в наличии → «Нет в наличии»", () => {
    expect(productCtaLabel(st({ hasVariants: false, canBuySimple: false }))).toBe("Нет в наличии");
  });

  it("товар с размерами, но все размеры распроданы → «Нет в наличии»", () => {
    expect(
      productCtaLabel(st({ hasVariants: true, hasAvailableVariants: false })),
    ).toBe("Нет в наличии");
  });

  it("товар с размерами, есть доступные, размер не выбран → «Выберите размер»", () => {
    expect(
      productCtaLabel(st({ hasVariants: true, hasAvailableVariants: true, hasSelectedVariant: false })),
    ).toBe("Выберите размер");
  });

  it("товар с размерами, размер выбран → «В корзину»", () => {
    expect(
      productCtaLabel(st({ hasVariants: true, hasAvailableVariants: true, hasSelectedVariant: true })),
    ).toBe("В корзину");
  });

  it("«Нет в наличии» имеет приоритет над «Выберите размер» при распроданных размерах", () => {
    // даже если размер как-то выбран, но доступных нет — не предлагаем покупку
    expect(
      productCtaLabel(st({ hasVariants: true, hasAvailableVariants: false, hasSelectedVariant: true })),
    ).toBe("Нет в наличии");
  });
});
