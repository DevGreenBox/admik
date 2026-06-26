import { describe, it, expect } from "vitest";
import { variantUnavailableLabel } from "@/lib/variant-availability";

describe("variantUnavailableLabel (C28)", () => {
  it("вариант не в наличии → подпись с размером и причиной", () => {
    const label = variantUnavailableLabel({ size: "M", inStock: false });
    expect(label).toContain("M");
    expect(label).toContain("нет в наличии");
  });

  it("вариант в наличии → null (подсказка не нужна)", () => {
    expect(variantUnavailableLabel({ size: "L", inStock: true })).toBe(null);
  });
});
