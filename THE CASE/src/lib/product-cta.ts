/**
 * Подпись кнопки покупки на карточке товара — ЕДИНЫЙ источник истины для основной
 * кнопки и плавающей (StickyAddToCart). Чистая функция (без React) → тестируется
 * юнит-тестами (product-cta.test.ts). Логика вынесена, чтобы обе кнопки никогда не
 * расходились в надписи (ADR — переиспользование, без дублирования тернарника).
 */
export interface ProductCtaState {
  /** Только что добавлено в корзину (кратковременная подсветка). */
  added: boolean;
  /** У товара есть варианты (размеры). */
  hasVariants: boolean;
  /** Простой товар (без вариантов) можно купить (есть остаток + id). */
  canBuySimple: boolean;
  /** Среди вариантов есть хотя бы один в наличии. */
  hasAvailableVariants: boolean;
  /** Выбран конкретный вариант (размер). */
  hasSelectedVariant: boolean;
}

export function productCtaLabel(s: ProductCtaState): string {
  if (s.added) return "Добавлено";
  // Нечего купить: либо простой товар не в наличии, либо все размеры распроданы.
  if (!s.hasVariants && !s.canBuySimple) return "Нет в наличии";
  if (s.hasVariants && !s.hasAvailableVariants) return "Нет в наличии";
  // Есть что выбрать, но размер ещё не выбран.
  if (s.hasVariants && !s.hasSelectedVariant) return "Выберите размер";
  return "В корзину";
}
