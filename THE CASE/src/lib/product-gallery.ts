import type { StorefrontVariant } from './admik';

/**
 * Фотография товара с опциональной привязкой к варианту (product_media).
 * `variantId: null` — общее фото товара; `undefined` — бэкенд поле не отдал.
 */
export interface ProductImage {
  url: string;
  variantId?: string | null;
}

/** Нормализует название цвета для сравнения: регистр и краевые пробелы неважны. */
function norm(color: string | null | undefined): string {
  return typeof color === 'string' ? color.trim().toLowerCase() : '';
}

/**
 * Фотографии, которые нужно показать для выбранного цвета (правка владельца
 * 2026-07-22, п.2 — «при выборе цвета менялась фотка с этим цветом»).
 *
 * Порядок фолбэков продиктован реальным состоянием каталога THE CASE: цветов
 * заведено больше, чем отснято фотографий, поэтому пустая галерея — вероятный
 * сценарий, а не теоретический.
 *
 *   1) цвет выбран и у его вариантов есть фото → показываем ТОЛЬКО их;
 *   2) у цвета своих фото нет → общие фото товара (variantId = null);
 *   3) общих тоже нет → весь список, лишь бы галерея не была пустой.
 *
 * Порядок снимков внутри выборки сохраняется — он задан полем `sort` в админке.
 */
export function imagesForColor(
  images: ProductImage[],
  variants: StorefrontVariant[],
  color: string | null,
): string[] {
  const all = images.map((i) => i.url);
  const wanted = norm(color);
  if (!wanted) return all;

  // Идентификаторы вариантов выбранного цвета — по ним и отбираем снимки.
  const ids = new Set(
    variants.filter((v) => norm(v.color) === wanted).map((v) => v.id),
  );

  const own = images.filter((i) => i.variantId && ids.has(i.variantId)).map((i) => i.url);
  if (own.length > 0) return own;

  // Фолбэк: общие фото товара. Снимки ЧУЖИХ цветов сюда не попадают — иначе
  // покупатель выбрал бы «Бежевый» и увидел белый костюм.
  const common = images.filter((i) => i.variantId == null).map((i) => i.url);
  if (common.length > 0) return common;

  return all;
}
