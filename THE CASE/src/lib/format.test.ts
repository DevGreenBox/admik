import { describe, it, expect } from "vitest";
import { formatPrice, DEFAULT_CURRENCY, type StorefrontCurrency } from "@/lib/format";

/**
 * Тесты G-01 / Находка-13 — параметризуемый formatPrice из settings.currency.
 * Ключевая гарантия обратной совместимости: БЕЗ второго аргумента поведение
 * прежнее (₽, ru-RU, без копеек) — существующие вызовы витрины не меняются.
 * Сравниваем по цифрам/коду, не по конкретному виду пробелов (NBSP в Intl).
 */

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

describe("formatPrice — обратная совместимость (без валюты)", () => {
  it("по умолчанию — рубли, ru-RU, без копеек (как было)", () => {
    const r = formatPrice(1500);
    expect(r).toContain("₽");
    expect(digits(r)).toBe("1500");
    expect(r).not.toMatch(/[.,]\d\d/); // нет дробной части
  });

  it("явный DEFAULT_CURRENCY === поведение без аргумента", () => {
    expect(formatPrice(2399, DEFAULT_CURRENCY)).toBe(formatPrice(2399));
  });
});

describe("formatPrice — из настроек магазина", () => {
  it("число знаков после запятой из настроек (копейки)", () => {
    const cur: StorefrontCurrency = { code: "RUB", locale: "ru-RU", symbol: null, fractionDigits: 2 };
    const r = formatPrice(1500, cur);
    expect(r).toMatch(/1[\s ]?500,00/); // ru-RU группировка + 2 знака
    expect(r).toContain("₽");
  });

  it("другая валюта и локаль (USD / en-US)", () => {
    const cur: StorefrontCurrency = { code: "USD", locale: "en-US", symbol: null, fractionDigits: 2 };
    const r = formatPrice(19.5, cur);
    expect(r).toContain("$");
    expect(r).toContain("19.50");
  });

  it("валюта без подключённого символа в локали (KZT)", () => {
    const cur: StorefrontCurrency = { code: "KZT", locale: "ru-RU", symbol: null, fractionDigits: 0 };
    const r = formatPrice(5000, cur);
    expect(digits(r)).toBe("5000");
    // Intl выводит код/символ KZT — проверяем, что без копеек
    expect(r).not.toMatch(/[.,]\d\d/);
  });

  it("кастомный символ владельца замещает символ Intl, сохраняя числа", () => {
    const cur: StorefrontCurrency = { code: "USD", locale: "en-US", symbol: "USD$", fractionDigits: 2 };
    const r = formatPrice(10, cur);
    expect(r).toContain("USD$");
    expect(r).toContain("10.00");
    expect(r).not.toMatch(/(?<!USD)\$/); // нет «голого» $ без префикса USD
  });

  it("невалидный код валюты → грациозный фолбэк на дефолт витрины", () => {
    const cur: StorefrontCurrency = { code: "НЕВАЛИД", locale: "ru-RU", symbol: null, fractionDigits: 0 };
    const r = formatPrice(1500, cur);
    expect(r).toContain("₽");
    expect(digits(r)).toBe("1500");
  });

  it("невалидная локаль → грациозный фолбэк", () => {
    const cur: StorefrontCurrency = { code: "RUB", locale: "не-локаль!", symbol: null, fractionDigits: 0 };
    const r = formatPrice(1500, cur);
    expect(digits(r)).toBe("1500");
  });
});
