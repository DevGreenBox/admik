/**
 * Чистая логика «быстрого добавления в корзину» со страницы Избранного
 * (находка аудита 20) — без сети/React, тестируется юнит-тестами (wishlist.test.ts).
 *
 * На /wishlist карточки строятся из ПОЛНОГО detail-DTO (fromDetail), поэтому у
 * товара уже есть id/variants/inStock/availableQty — повторный фетч не нужен.
 * Логика выбора позиции корзины здесь та же, что в QuickViewModal (ProductCard):
 *  - товар БЕЗ вариантов и в наличии → добавляем сразу по productId;
 *  - товар С вариантами/размерами (или нечего купить) → ведём на карточку товара,
 *    где покупатель выберет размер (не угадываем размер за него).
 */

import type { CartItem } from '@/types';
import type { StorefrontProduct } from '@/lib/admik';

/** Что делать при клике «В корзину» на карточке Избранного. */
export type WishlistAddIntent =
  | {
      /** Простой товар без вариантов в наличии — добавляем сразу. */
      kind: 'add';
      item: Omit<CartItem, 'quantity'>;
    }
  | {
      /** Нужен выбор размера — вести на карточку товара. */
      kind: 'choose-size';
      slug: string;
    }
  | {
      /** Нечего купить (нет в наличии / нет id) — вести на карточку товара. */
      kind: 'unavailable';
      slug: string;
    };

/**
 * Решает действие для кнопки быстрого добавления Избранного.
 *
 * Простой товар (variants.length===0) покупается по productId — он есть только
 * у detail-карточки (product.id). При наличии id, остатка и inStock → 'add' с
 * готовой позицией. Товар с вариантами → 'choose-size' (размер выбирается на
 * карточке). Иначе ('unavailable') — тоже ведём на карточку (не блокируем UI).
 */
export function wishlistAddIntent(product: StorefrontProduct): WishlistAddIntent {
  const hasVariants = product.variants.length > 0;
  if (hasVariants) {
    return { kind: 'choose-size', slug: product.slug };
  }
  const canBuySimple =
    product.inStock && Boolean(product.id) && product.availableQty > 0;
  if (!canBuySimple) {
    return { kind: 'unavailable', slug: product.slug };
  }
  return {
    kind: 'add',
    item: {
      // Товар без вариантов: ключ позиции и productId — это id товара (ADR-010).
      variantId: product.id as string,
      productId: product.id as string,
      slug: product.slug,
      name: product.name,
      size: '',
      price: product.price,
      imageUrl: product.imageUrl,
      available: product.availableQty,
    },
  };
}
