import { describe, expect, it } from 'vitest';

import { mapVariant, uniqueSizes } from '@/lib/catalog/repository';
import { isColorAttribute } from '@/lib/catalog/color';
import {
  collectProductColors,
  toProductDetailDto,
  toVariantDto,
} from '@/lib/storefront/dto';
import type { ProductDetail, ProductVariant } from '@/lib/catalog/types';
import type { SeoCtx } from '@/lib/seo/meta';

// ЮНИТ (спринт B): цвет варианта доводится до публичного контракта витрины.
// Без БД: маппер строки → домен, домен → DTO, чистые агрегаторы.

const D = new Date('2026-01-01T00:00:00Z');

const seoCtx: SeoCtx = {
  siteUrl: 'https://shop.test',
  titleTemplate: '%s',
  siteName: 'Shop',
  defaultDescription: null,
  defaultOgImageKey: null,
  publicUrl: (k: string) => `https://cdn.test/${k}`,
  pathPrefix: '/products',
};

function variant(over: Partial<ProductVariant>): ProductVariant {
  return {
    id: 'v1',
    productId: 'p1',
    sku: 'V1',
    name: '42 / XS',
    priceOverride: null,
    priceDelta: '0.00',
    compareAtPrice: null,
    isActive: true,
    sort: 0,
    attributesCache: {},
    color: null,
    colorHex: null,
    weightG: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    createdAt: D,
    updatedAt: D,
    ...over,
  };
}

function product(variants: ProductVariant[]): ProductDetail {
  return {
    id: 'p1',
    sku: 'SKU1',
    slug: 'coat',
    name: 'Coat',
    description: '',
    status: 'active',
    basePrice: '1000.00',
    compareAtPrice: null,
    isFeatured: false,
    isNew: null,
    brandId: null,
    attributesCache: {},
    seoTitle: null,
    seoDescription: null,
    ogTitle: null,
    ogDescription: null,
    ogImageKey: null,
    canonicalUrl: null,
    noindex: false,
    weightG: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    createdAt: D,
    updatedAt: D,
    categories: [],
    variants,
    attributes: [],
    media: [],
    inventory: [],
    brand: null,
  };
}

describe('mapVariant — цвет варианта', () => {
  it('маппит color/color_hex из строки БД', () => {
    const v = mapVariant({
      id: 'v1',
      product_id: 'p1',
      sku: 'V1',
      name: '42 / XS',
      price_override: null,
      price_delta: '0.00',
      compare_at_price: null,
      is_active: true,
      sort: 0,
      attributes_cache: {},
      color: 'Белый',
      color_hex: '#FFFFFF',
      created_at: D,
      updated_at: D,
    });
    expect(v.color).toBe('Белый');
    expect(v.colorHex).toBe('#FFFFFF');
  });

  it('без цвета — null (а не undefined/пустая строка)', () => {
    const v = mapVariant({
      id: 'v1',
      product_id: 'p1',
      sku: 'V1',
      name: 'M',
      price_override: null,
      price_delta: '0.00',
      compare_at_price: null,
      is_active: true,
      sort: 0,
      attributes_cache: {},
      created_at: D,
      updated_at: D,
    });
    expect(v.color).toBeNull();
    expect(v.colorHex).toBeNull();
  });
});

describe('isColorAttribute — распознавание справочника «Цвет»', () => {
  it('узнаёт по имени и по коду, независимо от регистра', () => {
    expect(isColorAttribute({ code: 'demo-color', name: 'Цвет' })).toBe(true);
    expect(isColorAttribute({ code: 'COLOR', name: 'Что-то' })).toBe(true);
    expect(isColorAttribute({ code: 'x', name: 'цвет' })).toBe(true);
    expect(isColorAttribute({ code: 'tsvet', name: 'Colour' })).toBe(true);
  });

  it('не путает с другими справочниками', () => {
    expect(isColorAttribute({ code: 'demo-size', name: 'Размер' })).toBe(false);
    expect(isColorAttribute({ code: 'material', name: 'Материал' })).toBe(false);
  });
});

describe('toVariantDto — публичные поля цвета', () => {
  it('отдаёт color/colorHex варианта', () => {
    const v = variant({ color: 'Белый', colorHex: '#ffffff' });
    const dto = toVariantDto(v, product([v]));
    expect(dto.color).toBe('Белый');
    expect(dto.colorHex).toBe('#ffffff');
  });

  it('без цвета — null в обоих полях', () => {
    const v = variant({});
    const dto = toVariantDto(v, product([v]));
    expect(dto.color).toBeNull();
    expect(dto.colorHex).toBeNull();
  });
});

/**
 * Ключ схлопывания цветов обязан совпадать с витринным.
 *
 * Витрина нормализует название цвета как trim + lowercase + ё→е
 * (THE CASE/src/lib/color-swatch.ts, normalizeColorName), а бэкенд схлопывал
 * только по trim. При значениях справочника «Бежевый» и «бежевый» бэкенд отдавал
 * ДВА элемента colors, а витрина рисовала ОДИН свотч — данные и картинка расходились.
 * Это ровно тот класс расхождений между двумя приложениями, который typecheck не ловит.
 *
 * Схлопываем по нормализованному ключу, но ПОКАЗЫВАЕМ первое написание как есть.
 */
describe('collectProductColors — ключ схлопывания совпадает с витринным', () => {
  it('регистр не создаёт второй цвет, показывается первое написание', () => {
    expect(
      collectProductColors([
        { color: 'Бежевый', colorHex: '#D9C7A7' },
        { color: 'бежевый', colorHex: '#D9C7A7' },
        { color: 'БЕЖЕВЫЙ', colorHex: null },
      ]),
    ).toEqual([{ value: 'Бежевый', hex: '#D9C7A7' }]);
  });

  it('ё и е — один цвет (справочник ведут вручную, написание гуляет)', () => {
    expect(
      collectProductColors([
        { color: 'Чёрный', colorHex: '#000000' },
        { color: 'Черный', colorHex: '#000000' },
      ]),
    ).toEqual([{ value: 'Чёрный', hex: '#000000' }]);
  });

  it('hex подхватывается с первого варианта, где он задан, даже если написание иное', () => {
    expect(
      collectProductColors([
        { color: 'Белый', colorHex: null },
        { color: 'белый', colorHex: '#FFFFFF' },
      ]),
    ).toEqual([{ value: 'Белый', hex: '#FFFFFF' }]);
  });

  it('разные цвета остаются разными', () => {
    expect(
      collectProductColors([
        { color: 'Белый', colorHex: '#FFFFFF' },
        { color: 'Бежевый', colorHex: '#D9C7A7' },
      ]),
    ).toEqual([
      { value: 'Белый', hex: '#FFFFFF' },
      { value: 'Бежевый', hex: '#D9C7A7' },
    ]);
  });
});

describe('collectProductColors / ProductDetailDto.colors', () => {
  it('уникальные цвета в порядке появления у вариантов', () => {
    const vs = [
      variant({ id: 'v1', sku: 'a', name: '42 / XS', color: 'Белый', colorHex: '#FFFFFF' }),
      variant({ id: 'v2', sku: 'b', name: '44 / S', color: 'Белый', colorHex: '#FFFFFF' }),
      variant({ id: 'v3', sku: 'c', name: '42 / XS', color: 'Чёрный', colorHex: '#000000' }),
      variant({ id: 'v4', sku: 'd', name: '44 / S', color: 'Чёрный', colorHex: '#000000' }),
    ];
    const dto = toProductDetailDto(product(vs), {
      effectiveIsNew: false,
      categorySlugs: [],
      seoCtx,
    });
    expect(dto.colors).toEqual([
      { value: 'Белый', hex: '#FFFFFF' },
      { value: 'Чёрный', hex: '#000000' },
    ]);
    expect(dto.variants.map((v) => v.color)).toEqual([
      'Белый',
      'Белый',
      'Чёрный',
      'Чёрный',
    ]);
  });

  it('товар без заведённых цветов → пустой массив', () => {
    const vs = [variant({ id: 'v1' }), variant({ id: 'v2', sku: 'b' })];
    const dto = toProductDetailDto(product(vs), {
      effectiveIsNew: false,
      categorySlugs: [],
      seoCtx,
    });
    expect(dto.colors).toEqual([]);
  });

  it('неактивные варианты не дают цветов (их нет и в variants)', () => {
    const vs = [
      variant({ id: 'v1', color: 'Белый', colorHex: '#FFFFFF' }),
      variant({ id: 'v2', sku: 'b', color: 'Красный', isActive: false }),
    ];
    const dto = toProductDetailDto(product(vs), {
      effectiveIsNew: false,
      categorySlugs: [],
      seoCtx,
    });
    expect(dto.colors).toEqual([{ value: 'Белый', hex: '#FFFFFF' }]);
  });

  it('hex подхватывается с первого варианта, где он задан', () => {
    const colors = collectProductColors([
      { color: 'Белый', colorHex: null },
      { color: 'Белый', colorHex: '#FFFFFF' },
    ]);
    expect(colors).toEqual([{ value: 'Белый', hex: '#FFFFFF' }]);
  });

  it('пустые/пробельные значения цвета игнорируются', () => {
    expect(
      collectProductColors([
        { color: '', colorHex: '#FFFFFF' },
        { color: '   ', colorHex: null },
        { color: null, colorHex: null },
      ]),
    ).toEqual([]);
  });
});

describe('uniqueSizes — ловушка матрицы «цвет × размер»', () => {
  it('размеры не дублируются, когда варианты делят имя размера', () => {
    expect(uniqueSizes(['42 / XS', '44 / S', '42 / XS', '44 / S'])).toEqual([
      '42 / XS',
      '44 / S',
    ]);
  });

  it('порядок появления сохраняется, пустые отбрасываются', () => {
    expect(uniqueSizes(['46 / M', '', '42 / XS', '46 / M'])).toEqual([
      '46 / M',
      '42 / XS',
    ]);
  });
});
