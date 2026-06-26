/**
 * Подсказка о недоступности размера на PDP (C28). Чистый хелпер (по аналогии с
 * product-cta.ts) — тестируется без React.
 *
 * Нативно `disabled`-кнопка размера озвучивается скринридером лишь как «dimmed»,
 * без причины. Эта функция даёт обобщённую RU-причину для `title`/`aria-label`
 * (мультитенантно — текст интерфейса витрины, без привязки к магазину).
 */

import type { StorefrontVariant } from "@/lib/admik";

export function variantUnavailableLabel(
  variant: Pick<StorefrontVariant, "size" | "inStock">,
): string | null {
  if (variant.inStock) return null;
  return `Размер ${variant.size} — нет в наличии`;
}
