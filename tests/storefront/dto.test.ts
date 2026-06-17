import { describe, it, expect } from 'vitest';
import {
  toBrandDto,
  toFullBrandDto,
  toProductListItemDto,
  toProductDetailDto,
  toVariantDto,
  toCategoryTreeDto,
  computeInStock,
  effectiveVariantPrice,
} from '@/lib/storefront/dto';
import type {
  Brand,
  BrandRef,
  CategoryTreeNode,
  InventoryItem,
  ProductDetail,
  ProductListRow,
  ProductVariant,
} from '@/lib/catalog/types';
import type { SeoCtx } from '@/lib/seo/meta';

const D = new Date('2026-06-01T00:00:00Z');

/** Тестовый SeoCtx (домен/шаблон инъецируются — без чтения env/БД). */
const TEST_SEO_CTX: SeoCtx = {
  siteUrl: 'https://shop.test',
  titleTemplate: '%s',
  siteName: 'Shop',
  defaultDescription: null,
  defaultOgImageKey: null,
  publicUrl: (k: string) => `https://cdn.test/${k}`,
  pathPrefix: 'product',
};

const brandRef: BrandRef = {
  id: 'b1',
  slug: 'bosch',
  name: 'Bosch',
  logoKey: 'brands/bosch.png',
  logoUrl: 'https://cdn/bosch.png',
};

describe('storefront/dto — бренды', () => {
  it('toBrandDto отдаёт только slug/name/logoUrl (без logoKey/id)', () => {
    const dto = toBrandDto(brandRef);
    expect(dto).toEqual({
      slug: 'bosch',
      name: 'Bosch',
      logoUrl: 'https://cdn/bosch.png',
    });
    // Не должно быть внутренних полей.
    expect(dto).not.toHaveProperty('id');
    expect(dto).not.toHaveProperty('logoKey');
  });

  it('toBrandDto(null) → null', () => {
    expect(toBrandDto(null)).toBeNull();
  });

  it('toFullBrandDto скрывает id/sort/isActive/даты', () => {
    const brand: Brand = {
      id: 'b1',
      slug: 'bosch',
      name: 'Bosch',
      description: 'desc',
      logoKey: 'k',
      logoUrl: 'u',
      isActive: true,
      sort: 5,
      seoTitle: 't',
      seoDescription: 'd',
      ogTitle: null,
      ogDescription: null,
      ogImageKey: null,
      canonicalUrl: null,
      noindex: false,
      createdAt: D,
      updatedAt: D,
    };
    const dto = toFullBrandDto(brand, { seoCtx: TEST_SEO_CTX });
    expect(dto).not.toHaveProperty('id');
    expect(dto).not.toHaveProperty('logoKey');
    expect(dto).not.toHaveProperty('isActive');
    expect(dto).not.toHaveProperty('sort');
    expect(dto).not.toHaveProperty('createdAt');
    expect(dto.slug).toBe('bosch');
  });
});

describe('storefront/dto — список товаров', () => {
  const row: ProductListRow = {
    id: 'p1',
    sku: 'SKU1',
    slug: 'brake-pad',
    name: 'Brake pad',
    status: 'active',
    basePrice: '790.00',
    compareAtPrice: '1000.00',
    discountPct: 21,
    onSale: true,
    isFeatured: true,
    effectiveIsNew: true,
    brand: brandRef,
    totalStock: 3,
    availableStock: 3,
    primaryMediaUrl: 'https://cdn/img.jpg',
    createdAt: D,
  };

  it('маппит цену/скидку и inStock из доступного остатка; не утекает status/id/sku', () => {
    const dto = toProductListItemDto(row);
    expect(dto.price).toBe('790.00');
    expect(dto.compareAtPrice).toBe('1000.00');
    expect(dto.discountPct).toBe(21);
    expect(dto.onSale).toBe(true);
    expect(dto.isNew).toBe(true);
    expect(dto.isFeatured).toBe(true);
    expect(dto.brand).toEqual({ slug: 'bosch', name: 'Bosch', logoUrl: 'https://cdn/bosch.png' });
    expect(dto.imageUrl).toBe('https://cdn/img.jpg');
    expect(dto.inStock).toBe(true);
    // Внутренние поля наружу не отдаём.
    expect(dto).not.toHaveProperty('id');
    expect(dto).not.toHaveProperty('status');
    expect(dto).not.toHaveProperty('totalStock');
    expect(dto).not.toHaveProperty('availableStock');
  });

  it('inStock=false при нулевом доступном остатке', () => {
    expect(
      toProductListItemDto({ ...row, totalStock: 0, availableStock: 0 }).inStock,
    ).toBe(false);
  });

  // РЕГРЕСС (major, data-integrity): весь физический остаток зарезервирован под
  // незавершённые заказы → доступное = 0, витрина НЕ должна показывать «в наличии».
  // Семантика совпадает с computeInStock карточки/детали: in stock = quantity−reserved>0.
  it('inStock=false когда физический остаток есть, но весь зарезервирован', () => {
    const dto = toProductListItemDto({ ...row, totalStock: 5, availableStock: 0 });
    expect(dto.inStock).toBe(false);
  });

  it('inStock=true когда доступно хоть сколько-то при наличии резерва', () => {
    const dto = toProductListItemDto({ ...row, totalStock: 5, availableStock: 2 });
    expect(dto.inStock).toBe(true);
  });
});

describe('storefront/dto — computeInStock / цена варианта', () => {
  const inv: InventoryItem[] = [
    { id: 'i1', productId: 'p1', variantId: 'v1', warehouseCode: 'W', quantity: 0, reserved: 0, updatedAt: D },
    { id: 'i2', productId: 'p1', variantId: 'v2', warehouseCode: 'W', quantity: 5, reserved: 0, updatedAt: D },
  ];

  it('computeInStock по товару — true, если есть положительный остаток', () => {
    expect(computeInStock(inv)).toBe(true);
  });

  it('computeInStock по варианту — учитывает только его строки', () => {
    expect(computeInStock(inv, 'v1')).toBe(false);
    expect(computeInStock(inv, 'v2')).toBe(true);
  });

  it('computeInStock учитывает reserved: доступно = quantity − reserved', () => {
    // Весь остаток зарезервирован → не в наличии для витрины.
    const reserved: InventoryItem[] = [
      { id: 'i', productId: 'p1', variantId: null, warehouseCode: 'W', quantity: 5, reserved: 5, updatedAt: D },
    ];
    expect(computeInStock(reserved)).toBe(false);
    // Часть зарезервирована, но что-то доступно → в наличии.
    const partial: InventoryItem[] = [
      { id: 'i', productId: 'p1', variantId: null, warehouseCode: 'W', quantity: 5, reserved: 4, updatedAt: D },
    ];
    expect(computeInStock(partial)).toBe(true);
    // Reserved больше остатка (рассинхрон) → не уходит в минус, не в наличии.
    const over: InventoryItem[] = [
      { id: 'i', productId: 'p1', variantId: null, warehouseCode: 'W', quantity: 2, reserved: 5, updatedAt: D },
    ];
    expect(computeInStock(over)).toBe(false);
  });

  it('computeInStock по варианту учитывает reserved этого варианта', () => {
    const v: InventoryItem[] = [
      { id: 'i1', productId: 'p1', variantId: 'v1', warehouseCode: 'W', quantity: 3, reserved: 3, updatedAt: D },
      { id: 'i2', productId: 'p1', variantId: 'v2', warehouseCode: 'W', quantity: 3, reserved: 1, updatedAt: D },
    ];
    expect(computeInStock(v, 'v1')).toBe(false);
    expect(computeInStock(v, 'v2')).toBe(true);
  });

  it('effectiveVariantPrice: override, иначе base+delta', () => {
    const base: ProductVariant = {
      id: 'v', productId: 'p', sku: 's', name: '', priceOverride: null,
      priceDelta: '50.00', compareAtPrice: null, isActive: true, sort: 0,
      attributesCache: {}, weightG: null, lengthCm: null, widthCm: null, heightCm: null,
      createdAt: D, updatedAt: D,
    };
    expect(effectiveVariantPrice(base, '100.00')).toBe('150.00');
    expect(effectiveVariantPrice({ ...base, priceOverride: '200.00' }, '100.00')).toBe('200.00');
  });
});

describe('storefront/dto — карточка товара', () => {
  const variant: ProductVariant = {
    id: 'v1', productId: 'p1', sku: 'V1', name: 'M',
    priceOverride: null, priceDelta: '0.00', compareAtPrice: null,
    isActive: true, sort: 0, attributesCache: { size: 'M' },
    weightG: null, lengthCm: null, widthCm: null, heightCm: null,
    createdAt: D, updatedAt: D,
  };
  const inactiveVariant: ProductVariant = { ...variant, id: 'v2', isActive: false };

  const product: ProductDetail = {
    id: 'p1', sku: 'SKU1', slug: 'coat', name: 'Coat', description: 'nice',
    status: 'active', basePrice: '1000.00', compareAtPrice: '1500.00',
    isFeatured: false, isNew: null, brandId: 'b1',
    attributesCache: { color: 'white' }, seoTitle: null, seoDescription: null,
    ogTitle: null, ogDescription: null, ogImageKey: null, canonicalUrl: null, noindex: false,
    weightG: null, lengthCm: null, widthCm: null, heightCm: null,
    createdAt: D, updatedAt: D,
    categories: [{ categoryId: 'c1', isPrimary: true }],
    variants: [variant, inactiveVariant],
    attributes: [],
    media: [
      { id: 'm1', productId: 'p1', variantId: null, storageKey: 'media/secret-key.jpg',
        url: 'https://cdn/a.jpg', type: 'image', mime: 'image/jpeg', alt: 'a',
        width: 10, height: 10, sizeBytes: 999, sort: 0, isPrimary: true, createdAt: D },
    ],
    inventory: [
      { id: 'i1', productId: 'p1', variantId: 'v1', warehouseCode: 'W', quantity: 2, reserved: 0, updatedAt: D },
    ],
    brand: brandRef,
  };

  it('маппит цену/скидку, бренд, категории-slug, медиа без storageKey', () => {
    const dto = toProductDetailDto(product, {
      effectiveIsNew: true,
      categorySlugs: ['outerwear'],
      seoCtx: TEST_SEO_CTX,
    });
    expect(dto.slug).toBe('coat');
    expect(dto.price).toBe('1000.00');
    expect(dto.discountPct).toBe(33); // round((1500-1000)/1500*100)
    expect(dto.onSale).toBe(true);
    expect(dto.isNew).toBe(true);
    expect(dto.brand?.slug).toBe('bosch');
    expect(dto.categories).toEqual(['outerwear']);
    expect(dto.inStock).toBe(true);
    // Медиа — без внутреннего storageKey/sizeBytes.
    expect(dto.media[0]).not.toHaveProperty('storageKey');
    expect(dto.media[0]).not.toHaveProperty('sizeBytes');
    expect(dto.media[0]!.url).toBe('https://cdn/a.jpg');
    // Публичный id товара отдаётся НАМЕРЕННО — витрине нужен productId для заказа
    // товара без вариантов (cart/quote/orders по productId, ADR-010); по
    // чувствительности сопоставимо с уже публичными id вариантов.
    expect(dto.id).toBe('p1');
    // Прочие внутренние поля карточки по-прежнему не утекают.
    expect(dto).not.toHaveProperty('status');
    expect(dto).not.toHaveProperty('attributesCache');
  });

  it('отдаёт только активные варианты, у варианта inStock и без сырого id остатка', () => {
    const dto = toProductDetailDto(product, {
      effectiveIsNew: false,
      categorySlugs: [],
      seoCtx: TEST_SEO_CTX,
    });
    expect(dto.variants).toHaveLength(1);
    const v = dto.variants[0]!;
    expect(v.id).toBe('v1');
    expect(v.name).toBe('M'); // человекочитаемая метка варианта (размер) для витрины
    expect(v.inStock).toBe(true);
    expect(v.attributes).toEqual({ size: 'M' });
    expect(v).not.toHaveProperty('priceDelta');
    expect(v).not.toHaveProperty('productId');
  });

  // Регресс (Prevki «Халат, остаток 50, но нет в наличии» + «не выбрать размер»):
  // товар БЕЗ вариантов с остатком на УРОВНЕ ТОВАРА (variant_id = null) должен
  // отдавать id (для заказа по productId), inStock=true и пустой список вариантов.
  it('товар без вариантов + остаток на уровне товара → id, inStock=true, variants пуст', () => {
    const simple: ProductDetail = {
      ...product,
      variants: [],
      inventory: [
        { id: 'i0', productId: 'p1', variantId: null, warehouseCode: 'W', quantity: 50, reserved: 0, updatedAt: D },
      ],
    };
    const dto = toProductDetailDto(simple, {
      effectiveIsNew: false,
      categorySlugs: [],
      seoCtx: TEST_SEO_CTX,
    });
    expect(dto.id).toBe('p1');
    expect(dto.variants).toHaveLength(0);
    expect(dto.inStock).toBe(true);
  });

  it('toVariantDto наследует compareAtPrice товара, считает скидку', () => {
    const dto = toVariantDto(variant, product);
    // variant.compareAtPrice=null → наследует product 1500.
    expect(dto.compareAtPrice).toBe('1500.00');
    expect(dto.onSale).toBe(true);
    expect(dto.discountPct).toBe(33);
  });
});

describe('storefront/dto — дерево категорий', () => {
  const tree: CategoryTreeNode[] = [
    {
      id: 'c1', parentId: null, slug: 'men', name: 'Men', description: '',
      sort: 0, isActive: true, seoTitle: null, seoDescription: null,
      ogTitle: null, ogDescription: null, ogImageKey: null, canonicalUrl: null, noindex: false,
      createdAt: D, updatedAt: D,
      children: [
        {
          id: 'c2', parentId: 'c1', slug: 'coats', name: 'Coats', description: 'd',
          sort: 0, isActive: true, seoTitle: null, seoDescription: null,
          ogTitle: null, ogDescription: null, ogImageKey: null, canonicalUrl: null, noindex: false,
          createdAt: D, updatedAt: D, children: [],
        },
        {
          id: 'c3', parentId: 'c1', slug: 'hidden', name: 'Hidden', description: '',
          sort: 1, isActive: false, seoTitle: null, seoDescription: null,
          ogTitle: null, ogDescription: null, ogImageKey: null, canonicalUrl: null, noindex: false,
          createdAt: D, updatedAt: D, children: [],
        },
      ],
    },
  ];

  it('скрывает неактивные ветви, отдаёт slug/name/description/children', () => {
    const dto = toCategoryTreeDto(tree);
    expect(dto).toHaveLength(1);
    expect(dto[0]!.slug).toBe('men');
    expect(dto[0]!.children).toHaveLength(1);
    expect(dto[0]!.children[0]!.slug).toBe('coats');
    expect(dto[0]!).not.toHaveProperty('id');
    expect(dto[0]!).not.toHaveProperty('isActive');
  });
});
