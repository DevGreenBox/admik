/**
 * Свотч цвета: название цвета → hex для кружка-образца.
 *
 * ИСТОЧНИК ИСТИНЫ — бэкенд: `attribute_values.color_hex` приезжает в витрину как
 * `colorHex` (вариант) / `colors[].hex` (товар). Локальная палитра ниже — ТОЛЬКО
 * ФОЛБЭК на случай, когда цвет в справочнике Admik заведён без hex. Дописывать
 * сюда цвета конкретного магазина не нужно (мультитенантность): правильный путь —
 * заполнить hex в справочнике атрибутов.
 *
 * Чистый модуль → тестируется юнит-тестами (color-swatch.test.ts).
 */

/** Нейтральный серый: цвет не в палитре и hex с бэкенда не задан. */
export const FALLBACK_COLOR_HEX = "#c8c8c8";

/**
 * «#RRGGBB» в любом регистре. Трёхсимвольный «#fff» намеренно не принимаем —
 * контракт спринта B фиксирует ровно шесть знаков (тот же CHECK в БД).
 */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Ключи — уже нормализованные (нижний регистр, ё→е), см. normalizeColorName.
const COLOR_SWATCHES: Record<string, string> = {
  белый: "#ffffff",
  графит: "#3a3a3d",
  черный: "#1a1a1a",
  серый: "#8a8a8a",
  синий: "#2b3a55",
  бежевый: "#d8cbb8",
};

/**
 * Нормализация названия цвета для сравнения: обрезка, нижний регистр, ё→е.
 * «Чёрный», «черный», «ЧЁРНЫЙ» — один и тот же цвет.
 */
export function normalizeColorName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/ё/g, "е");
}

/** Валиден ли hex с бэкенда («#RRGGBB»). */
export function isValidColorHex(hex: string | null | undefined): boolean {
  return typeof hex === "string" && HEX_RE.test(hex.trim());
}

/**
 * Hex для свотча: hex с бэкенда (если валиден) → палитра-фолбэк по названию →
 * нейтральный серый.
 */
export function colorHex(name: string, hex?: string | null): string {
  if (isValidColorHex(hex)) return (hex as string).trim();
  return COLOR_SWATCHES[normalizeColorName(name)] ?? FALLBACK_COLOR_HEX;
}
