import { describe, it, expect } from 'vitest';
import { wishlistAddIntent } from './wishlist';
import type { StorefrontProduct, StorefrontVariant } from '@/lib/admik';

function variant(over: Partial<StorefrontVariant> = {}): StorefrontVariant {
  return {
    id: 'var-1',
    sku: 'SKU-1',
    size: 'M',
    price: 4900,
    inStock: true,
    availableQty: 5,
    ...over,
  };
}

function product(over: Partial<StorefrontProduct> = {}): StorefrontProduct {
  return {
    id: 'prod-1',
    slug: 'halat',
    name: 'Халат',
    price: 4900,
    discountPct: null,
    onSale: false,
    isNew: false,
    isBestseller: false,
    inStock: true,
    availableQty: 7,
    imageUrl: 'https://cdn/x.webp',
    images: ['https://cdn/x.webp'],
    brand: null,
    categories: [],
    gender: 'unisex',
    color: '',
    colors: [],
    composition: '',
    care: '',
    features: [],
    description: '',
    variants: [],
    sizes: [],
    ...over,
  };
}

describe('wishlistAddIntent', () => {
  it('товар БЕЗ вариантов и в наличии → add с готовой позицией по productId', () => {
    const res = wishlistAddIntent(product({ id: 'prod-1', variants: [] }));
    expect(res.kind).toBe('add');
    if (res.kind === 'add') {
      expect(res.item).toEqual({
        variantId: 'prod-1',
        productId: 'prod-1',
        slug: 'halat',
        name: 'Халат',
        size: '',
        price: 4900,
        imageUrl: 'https://cdn/x.webp',
        available: 7,
      });
    }
  });

  it('товар С вариантами → choose-size (размер выбирается на карточке)', () => {
    const res = wishlistAddIntent(
      product({ variants: [variant({ id: 'v1', size: 'S' }), variant({ id: 'v2', size: 'L' })] }),
    );
    expect(res).toEqual({ kind: 'choose-size', slug: 'halat' });
  });

  it('простой товар не в наличии → unavailable (ведём на карточку)', () => {
    const res = wishlistAddIntent(product({ variants: [], inStock: false }));
    expect(res).toEqual({ kind: 'unavailable', slug: 'halat' });
  });

  it('простой товар с нулевым остатком → unavailable', () => {
    const res = wishlistAddIntent(product({ variants: [], availableQty: 0 }));
    expect(res).toEqual({ kind: 'unavailable', slug: 'halat' });
  });

  it('нет id (списочный снимок без detail) → unavailable, не добавляем вслепую', () => {
    const res = wishlistAddIntent(product({ variants: [], id: undefined }));
    expect(res).toEqual({ kind: 'unavailable', slug: 'halat' });
  });
});
