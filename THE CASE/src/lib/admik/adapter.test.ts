import { describe, it, expect } from 'vitest';
import {
  parseMoney,
  readAttr,
  readAttrString,
  readFeatures,
  resolveGender,
  variantSize,
  sortVariants,
  toStorefrontVariant,
  fromListItem,
  fromDetail,
} from './adapter';
import type {
  AdmikProductDetailDto,
  AdmikProductListItemDto,
  AdmikVariantDto,
  StorefrontVariant,
} from './types';

function variant(over: Partial<AdmikVariantDto> = {}): AdmikVariantDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    sku: 'SKU-1',
    name: 'M',
    price: '4900.00',
    compareAtPrice: null,
    discountPct: null,
    onSale: false,
    attributes: { size: 'M' },
    inStock: true,
    availableQty: 10,
    ...over,
  };
}

describe('parseMoney', () => {
  it('строку NUMERIC → number', () => {
    expect(parseMoney('4900.00')).toBe(4900);
    expect(parseMoney('1234.56')).toBeCloseTo(1234.56);
  });
  it('пустое/невалидное → 0', () => {
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney(undefined)).toBe(0);
    expect(parseMoney('abc')).toBe(0);
  });
});

describe('readAttr / readAttrString', () => {
  const attrs = { Color: 'Серый', 'Состав': '95% хлопок', empty: '' };
  it('регистронезависимый поиск по ключам-кандидатам', () => {
    expect(readAttrString(attrs, ['color', 'цвет'])).toBe('Серый');
    expect(readAttrString(attrs, ['composition', 'состав'])).toBe('95% хлопок');
  });
  it('пропускает пустые значения и берёт дефолт', () => {
    expect(readAttr(attrs, ['empty'])).toBeUndefined();
    expect(readAttrString(attrs, ['missing'], 'дефолт')).toBe('дефолт');
  });
  it('массив склеивается через запятую', () => {
    expect(readAttrString({ tags: ['a', 'b'] }, ['tags'])).toBe('a, b');
  });
});

describe('readFeatures', () => {
  it('массив строк как есть', () => {
    expect(readFeatures({ features: ['Воротник', 'Карманы'] })).toEqual(['Воротник', 'Карманы']);
  });
  it('строка с разделителями → массив', () => {
    expect(readFeatures({ особенности: 'A; B, C\nD' })).toEqual(['A', 'B', 'C', 'D']);
  });
  it('нет атрибута → пустой массив', () => {
    expect(readFeatures({})).toEqual([]);
  });
});

describe('resolveGender', () => {
  it('из атрибута (латиница/кириллица)', () => {
    expect(resolveGender({ gender: 'women' })).toBe('women');
    expect(resolveGender({ пол: 'Мужской' })).toBe('men');
    expect(resolveGender({ gender: 'унисекс' })).toBe('unisex');
  });
  it('фолбэк из slug категорий', () => {
    expect(resolveGender({}, ['zhenskaya-forma'])).toBe('women');
    expect(resolveGender({}, ['men'])).toBe('men');
  });
  it('по умолчанию unisex', () => {
    expect(resolveGender({}, ['accessories'])).toBe('unisex');
  });
});

describe('варианты-размеры', () => {
  it('variantSize: attributes.size → имя варианта → sku', () => {
    expect(variantSize(variant({ attributes: { size: 'L' }, name: 'X' }))).toBe('L');
    // нет size-атрибута → имя варианта
    expect(variantSize(variant({ attributes: {}, name: 'XL', sku: 'SKU-X' }))).toBe('XL');
    // нет size-атрибута и имени → sku
    expect(variantSize(variant({ attributes: {}, name: '', sku: 'ONLY-SKU' }))).toBe('ONLY-SKU');
  });
  it('toStorefrontVariant маппит цену и наличие', () => {
    const v = toStorefrontVariant(variant({ price: '5200.00', inStock: false }));
    expect(v).toMatchObject({ size: 'M', price: 5200, inStock: false });
    expect(v.id).toBe('00000000-0000-0000-0000-000000000001');
  });
  it('sortVariants: канон XS<S<M<L<XL<XXL, неизвестные в конец', () => {
    const mk = (size: string): StorefrontVariant => ({ id: size, sku: size, size, price: 0, inStock: true, availableQty: 5 });
    const sorted = sortVariants([mk('XL'), mk('S'), mk('ZZ'), mk('M'), mk('XS')]);
    expect(sorted.map((v) => v.size)).toEqual(['XS', 'S', 'M', 'XL', 'ZZ']);
  });
});

describe('fromListItem', () => {
  const dto: AdmikProductListItemDto = {
    slug: 'tunic-pro',
    name: 'Tunic Pro',
    price: '4900.00',
    compareAtPrice: '5900.00',
    discountPct: 17,
    onSale: true,
    isNew: true,
    isFeatured: true,
    brand: { slug: 'the-case', name: 'THE CASE', logoUrl: null },
    imageUrl: 'https://cdn.example/img.webp',
    inStock: true,
    availableQty: 7,
  };
  it('карточка: цены, бейджи, бренд, изображение', () => {
    const p = fromListItem(dto);
    expect(p).toMatchObject({
      slug: 'tunic-pro',
      name: 'Tunic Pro',
      price: 4900,
      oldPrice: 5900,
      onSale: true,
      isNew: true,
      isBestseller: true, // isFeatured → bestseller
      inStock: true,
      imageUrl: 'https://cdn.example/img.webp',
    });
    expect(p.images).toEqual(['https://cdn.example/img.webp']);
    expect(p.brand).toEqual({ slug: 'the-case', name: 'THE CASE' });
    expect(p.variants).toEqual([]);
    expect(p.gender).toBe('unisex');
  });
  it('без старой цены oldPrice = undefined', () => {
    expect(fromListItem({ ...dto, compareAtPrice: null }).oldPrice).toBeUndefined();
  });
});

describe('fromDetail', () => {
  const dto: AdmikProductDetailDto = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    slug: 'kostyum-essential',
    sku: 'KE-001',
    name: 'Костюм Essential',
    description: 'Описание',
    price: '10900.00',
    compareAtPrice: null,
    discountPct: null,
    onSale: false,
    isNew: false,
    isFeatured: true,
    brand: null,
    categories: ['zhenskaya-forma', 'kostyumy'],
    attributes: {
      gender: 'women',
      color: 'Графит',
      composition: '70% хлопок',
      care: 'Стирка 30°',
      features: ['Воротник-стойка', 'Карманы'],
    },
    variants: [
      variant({ id: 'v-xl', sku: 'KE-XL', attributes: { size: 'XL' } }),
      variant({ id: 'v-s', sku: 'KE-S', attributes: { size: 'S' }, inStock: false }),
      variant({ id: 'v-m', sku: 'KE-M', attributes: { size: 'M' } }),
    ],
    media: [
      { url: 'https://cdn.example/1.webp', type: 'image', alt: '', isPrimary: true },
      { url: 'https://cdn.example/2.webp', type: 'image', alt: '', isPrimary: false },
      { url: null, type: 'image', alt: '', isPrimary: false },
    ],
    inStock: true,
    availableQty: 25,
    meta: {
      title: 'Костюм Essential',
      description: 'Описание',
      canonical: null,
      ogTitle: 'Костюм Essential',
      ogDescription: null,
      ogImageUrl: null,
      noindex: false,
    },
  };

  it('атрибуты → поля витрины', () => {
    const p = fromDetail(dto);
    expect(p.gender).toBe('women');
    expect(p.color).toBe('Графит');
    expect(p.composition).toBe('70% хлопок');
    expect(p.care).toBe('Стирка 30°');
    expect(p.features).toEqual(['Воротник-стойка', 'Карманы']);
    expect(p.isBestseller).toBe(true);
  });

  it('варианты отсортированы и несут uuid/наличие', () => {
    const p = fromDetail(dto);
    expect(p.sizes).toEqual(['S', 'M', 'XL']);
    expect(p.variants.map((v) => v.id)).toEqual(['v-s', 'v-m', 'v-xl']);
    expect(p.variants.find((v) => v.size === 'S')?.inStock).toBe(false);
  });

  it('медиа: только непустые url, первое — главное изображение', () => {
    const p = fromDetail(dto);
    expect(p.images).toEqual(['https://cdn.example/1.webp', 'https://cdn.example/2.webp']);
    expect(p.imageUrl).toBe('https://cdn.example/1.webp');
  });
});

// ---------------------------------------------------------------------------
// Цвет как вариант (спринт B): variant.color/colorHex + product.colors.
// ---------------------------------------------------------------------------

describe('цвет варианта (color/colorHex)', () => {
  it('toStorefrontVariant протаскивает цвет и hex из DTO', () => {
    const v = toStorefrontVariant(variant({ color: 'Белый', colorHex: '#ffffff' }));
    expect(v.color).toBe('Белый');
    expect(v.colorHex).toBe('#ffffff');
  });

  it('цвета нет → null (а не пустая строка/undefined-мусор)', () => {
    const v = toStorefrontVariant(variant());
    expect(v.color).toBeNull();
    expect(v.colorHex).toBeNull();
  });

  it('фолбэк: цвет из вариантного attributes_cache, если поля color нет', () => {
    const v = toStorefrontVariant(variant({ attributes: { size: 'M', 'Цвет': 'Графит' } }));
    expect(v.color).toBe('Графит');
  });

  it('размер НЕ подменяется цветом (v.name остаётся меткой размера)', () => {
    const v = toStorefrontVariant(
      variant({ name: '42 / XS', attributes: {}, color: 'Белый' }),
    );
    expect(v.size).toBe('42 / XS');
  });
});

describe('fromDetail: colors', () => {
  const base: AdmikProductDetailDto = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    slug: 'p',
    sku: 'P-1',
    name: 'P',
    description: '',
    price: '100.00',
    compareAtPrice: null,
    discountPct: null,
    onSale: false,
    isNew: false,
    isFeatured: false,
    brand: null,
    categories: [],
    attributes: {},
    variants: [],
    media: [],
    inStock: true,
    availableQty: 1,
    meta: {
      title: 'P',
      description: null,
      canonical: null,
      ogTitle: 'P',
      ogDescription: null,
      ogImageUrl: null,
      noindex: false,
    },
  };

  it('уникальные цвета вариантов с hex', () => {
    const p = fromDetail({
      ...base,
      variants: [
        variant({ id: 'w-s', name: 'S', attributes: { size: 'S' }, color: 'Белый', colorHex: '#ffffff' }),
        variant({ id: 'w-m', name: 'M', attributes: { size: 'M' }, color: 'Белый', colorHex: '#ffffff' }),
        variant({ id: 'b-m', name: 'M', attributes: { size: 'M' }, color: 'Чёрный', colorHex: '#111111' }),
      ],
    });
    expect(p.colors).toEqual([
      { value: 'Белый', hex: '#ffffff' },
      { value: 'Чёрный', hex: '#111111' },
    ]);
  });

  it('цвета не заведены → пустой массив', () => {
    expect(fromDetail(base).colors).toEqual([]);
    expect(
      fromDetail({ ...base, variants: [variant({ id: 'a', attributes: { size: 'M' } })] }).colors,
    ).toEqual([]);
  });

  it('объявленный список товара задаёт порядок цветов', () => {
    const p = fromDetail({
      ...base,
      colors: [
        { value: 'Чёрный', hex: '#111111' },
        { value: 'Белый', hex: '#ffffff' },
      ],
      variants: [
        variant({ id: 'w', name: 'S', attributes: { size: 'S' }, color: 'Белый' }),
        variant({ id: 'b', name: 'S', attributes: { size: 'S' }, color: 'Чёрный' }),
      ],
    });
    expect(p.colors.map((c) => c.value)).toEqual(['Чёрный', 'Белый']);
    expect(p.colors[1].hex).toBe('#ffffff');
  });

  it('матрица цвет×размер: sizes без дублей', () => {
    const p = fromDetail({
      ...base,
      variants: [
        variant({ id: 'w-s', name: 'S', attributes: { size: 'S' }, color: 'Белый' }),
        variant({ id: 'w-m', name: 'M', attributes: { size: 'M' }, color: 'Белый' }),
        variant({ id: 'b-s', name: 'S', attributes: { size: 'S' }, color: 'Чёрный' }),
        variant({ id: 'b-m', name: 'M', attributes: { size: 'M' }, color: 'Чёрный' }),
      ],
    });
    expect(p.sizes).toEqual(['S', 'M']);
  });
});
