/**
 * Форматирование значений для UI витрины THE CASE.
 *
 * `formatPrice` — единая точка форматирования цены (₽, копейки скрыты).
 * Перенесено из устаревшего `src/lib/products.ts` (Wave B).
 */

export function formatPrice(price: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(price);
}
