import { describe, it, expect } from "vitest";
import { brandLabel } from "@/lib/brand-label";

describe("brandLabel (C23)", () => {
  it("возвращает имя бренда, когда он задан", () => {
    expect(brandLabel({ brand: { slug: "acme", name: "ACME" } })).toBe("ACME");
  });

  it("возвращает null, когда бренда нет", () => {
    expect(brandLabel({ brand: null })).toBe(null);
  });
});
