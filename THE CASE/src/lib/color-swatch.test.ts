import { describe, it, expect } from "vitest";
import { colorHex, FALLBACK_COLOR_HEX } from "@/lib/color-swatch";

describe("colorHex", () => {
  it("hex с бэкенда имеет приоритет над локальной палитрой", () => {
    expect(colorHex("Белый", "#0a0a0a")).toBe("#0a0a0a");
    expect(colorHex("неизвестный цвет", "#ABCDEF")).toBe("#ABCDEF");
  });

  it("невалидный hex с бэкенда игнорируется (уходим в фолбэк)", () => {
    expect(colorHex("белый", "красный")).toBe("#ffffff");
    expect(colorHex("белый", "#fff")).toBe("#ffffff");
    expect(colorHex("белый", "")).toBe("#ffffff");
    expect(colorHex("белый", null)).toBe("#ffffff");
  });

  it("фолбэк по названию — регистронезависимо и с обрезкой пробелов", () => {
    expect(colorHex("  БЕЛЫЙ ")).toBe("#ffffff");
    expect(colorHex("Графит")).toBe("#3a3a3d");
  });

  it("нормализация ё→е: «чёрный» и «черный» дают один hex", () => {
    expect(colorHex("чёрный")).toBe(colorHex("черный"));
    expect(colorHex("ЧЁРНЫЙ")).toBe(colorHex("Черный"));
    expect(colorHex("чёрный")).toBe("#1a1a1a");
  });

  it("неизвестное название → нейтральный фолбэк", () => {
    expect(colorHex("маджента")).toBe(FALLBACK_COLOR_HEX);
    expect(colorHex("")).toBe(FALLBACK_COLOR_HEX);
  });
});
