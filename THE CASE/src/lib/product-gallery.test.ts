import { describe, it, expect } from 'vitest';

import { imagesForColor, type ProductImage } from './product-gallery';
import type { StorefrontVariant } from './admik';

/**
 * Выбор фотографий под выбранный цвет (правка владельца 2026-07-22, п.2).
 *
 * Требование: покупатель выбирает «Графит» — галерея показывает графитовый
 * костюм, а не белый. Реализуется фильтром по привязке медиа к вариантам
 * этого цвета (product_media.variant_id → MediaDto.variantId).
 *
 * ГЛАВНЫЙ РИСК, который проверяют тесты: у THE CASE фото есть НЕ у всех
 * сочетаний (8 комбинаций товар+цвет, снимков два). Если для цвета снимков нет,
 * галерея НЕ должна опустеть — покупатель увидел бы пустой прямоугольник вместо
 * товара. В этом случае показываем общие фото товара.
 */
function v(id: string, color: string | null): StorefrontVariant {
  return { id, color, size: 'M', price: 100, inStock: true, availableQty: 5 } as StorefrontVariant;
}

const IMAGES: ProductImage[] = [
  { url: '/common.webp', variantId: null },
  { url: '/white-1.webp', variantId: 'v-white-m' },
  { url: '/white-2.webp', variantId: 'v-white-l' },
  { url: '/graphite-1.webp', variantId: 'v-graphite-m' },
];

const VARIANTS = [
  v('v-white-m', 'Белый'),
  v('v-white-l', 'Белый'),
  v('v-graphite-m', 'Графит'),
];

describe('imagesForColor', () => {
  it('цвет не выбран → все фото товара в исходном порядке', () => {
    expect(imagesForColor(IMAGES, VARIANTS, null)).toEqual([
      '/common.webp',
      '/white-1.webp',
      '/white-2.webp',
      '/graphite-1.webp',
    ]);
  });

  it('выбран цвет → только фото его вариантов', () => {
    expect(imagesForColor(IMAGES, VARIANTS, 'Белый')).toEqual(['/white-1.webp', '/white-2.webp']);
    expect(imagesForColor(IMAGES, VARIANTS, 'Графит')).toEqual(['/graphite-1.webp']);
  });

  it('у цвета нет своих фото → общие фото товара, а не пустая галерея', () => {
    // Именно этот случай у THE CASE сейчас: цветов больше, чем отснятых фото.
    const withBeige = [...VARIANTS, v('v-beige-m', 'Бежевый')];
    expect(imagesForColor(IMAGES, withBeige, 'Бежевый')).toEqual(['/common.webp']);
  });

  it('нет ни своих, ни общих фото → отдаём весь список (галерея не пустеет)', () => {
    const onlyVariantPhotos = IMAGES.filter((i) => i.variantId !== null);
    const withBeige = [...VARIANTS, v('v-beige-m', 'Бежевый')];
    const r = imagesForColor(onlyVariantPhotos, withBeige, 'Бежевый');
    expect(r.length).toBeGreaterThan(0);
  });

  it('сравнение цвета регистронезависимо и без краевых пробелов', () => {
    expect(imagesForColor(IMAGES, VARIANTS, '  белый ')).toEqual([
      '/white-1.webp',
      '/white-2.webp',
    ]);
  });

  it('бэкенд без variantId (старый контракт) → показываем всё как раньше', () => {
    const legacy: ProductImage[] = [{ url: '/a.webp' }, { url: '/b.webp' }];
    expect(imagesForColor(legacy, VARIANTS, 'Белый')).toEqual(['/a.webp', '/b.webp']);
  });

  it('пустой вход не роняет и не выдумывает картинок', () => {
    expect(imagesForColor([], VARIANTS, 'Белый')).toEqual([]);
    expect(imagesForColor(IMAGES, [], 'Белый')).toEqual(['/common.webp']);
  });
});
