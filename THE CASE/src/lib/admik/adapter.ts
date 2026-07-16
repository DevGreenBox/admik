/**
 * Чистые мапперы: DTO каталога Admik → витринная вью-модель THE CASE.
 *
 * Без сети/Next — тестируются юнит-тестами (adapter.test.ts). Контракт полей и
 * атрибутов — docs/13-сращивание-the-case.md §3.
 */

import type {
  AdmikProductDetailDto,
  AdmikProductListItemDto,
  AdmikVariantDto,
  StorefrontProduct,
  StorefrontVariant,
} from './types';

// ---------------------------------------------------------------------------
// Деньги: строка NUMERIC (₽) → number. Невалидное/пустое → 0.
// ---------------------------------------------------------------------------

export function parseMoney(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** compareAtPrice → oldPrice: число > 0 или undefined (нет старой цены). */
function parseOldPrice(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ---------------------------------------------------------------------------
// Атрибуты (EAV): чтение по списку ключей-кандидатов, регистронезависимо.
// ---------------------------------------------------------------------------

/** Возвращает первое непустое значение атрибута по списку ключей (case-insensitive). */
export function readAttr(
  attrs: Record<string, unknown> | null | undefined,
  keys: string[],
): unknown {
  if (!attrs) return undefined;
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(attrs)) {
    lower.set(k.toLowerCase().trim(), v);
  }
  for (const key of keys) {
    const v = lower.get(key.toLowerCase().trim());
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    if (!empty) return v;
  }
  return undefined;
}

/** Атрибут как строка (массив склеивается через запятую). Дефолт — пустая строка. */
export function readAttrString(
  attrs: Record<string, unknown> | null | undefined,
  keys: string[],
  def = '',
): string {
  const v = readAttr(attrs, keys);
  if (v === undefined) return def;
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join(', ');
  return String(v).trim();
}

/** «Особенности»: массив строк или строка с разделителями (`;` `\n` `,`). */
export function readFeatures(attrs: Record<string, unknown> | null | undefined): string[] {
  const v = readAttr(attrs, ['features', 'особенности']);
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v)
    .split(/[;\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Пол: атрибут → нормализация; иначе вывод из slug категорий; иначе unisex.
// ---------------------------------------------------------------------------

export function resolveGender(
  attrs: Record<string, unknown> | null | undefined,
  categories: string[] = [],
): 'women' | 'men' | 'unisex' {
  const raw = readAttrString(attrs, ['gender', 'пол']).toLowerCase();
  if (raw) {
    if (/(women|female|жен)/.test(raw)) return 'women';
    if (/(men|male|муж)/.test(raw)) return 'men';
    if (/(unisex|унисекс)/.test(raw)) return 'unisex';
  }
  const cats = categories.join(' ').toLowerCase();
  if (/(women|zhensk|жен)/.test(cats)) return 'women';
  if (/(\bmen\b|muzh|муж)/.test(cats)) return 'men';
  return 'unisex';
}

// ---------------------------------------------------------------------------
// Размеры (варианты): метка + сортировка по канону XS<S<M<L<XL<XXL.
// ---------------------------------------------------------------------------

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

function sizeRank(size: string): number {
  const idx = SIZE_ORDER.indexOf(size.toUpperCase().trim());
  return idx === -1 ? SIZE_ORDER.length : idx;
}

/**
 * Метка размера варианта: attributes.size → имя варианта → sku.
 * (Вариантный attributes_cache в Admik пока не пересобирается, поэтому основной
 * источник метки на практике — имя варианта из админки; см. docs/13 §3.3.)
 */
export function variantSize(v: AdmikVariantDto): string {
  return readAttrString(v.attributes, ['size', 'размер']) || v.name?.trim() || v.sku;
}

export function toStorefrontVariant(v: AdmikVariantDto): StorefrontVariant {
  return {
    id: v.id,
    sku: v.sku,
    size: variantSize(v),
    price: parseMoney(v.price),
    inStock: v.inStock,
    availableQty: Math.max(0, Math.trunc(v.availableQty ?? 0)),
  };
}

/** Сортирует варианты по каноническому порядку размеров (неизвестные — в конец, по алфавиту). */
export function sortVariants(variants: StorefrontVariant[]): StorefrontVariant[] {
  return [...variants].sort((a, b) => {
    const ra = sizeRank(a.size);
    const rb = sizeRank(b.size);
    if (ra !== rb) return ra - rb;
    return a.size.localeCompare(b.size, 'ru');
  });
}

// ---------------------------------------------------------------------------
// Товар: list-DTO (карточка) и detail-DTO (полная карточка) → StorefrontProduct.
// ---------------------------------------------------------------------------

/**
 * Список товаров: list-DTO теперь несёт фасетные поля gender/color/sizes (Мадина
 * №5 — для фильтра сетки по полу/цвету/размеру). Варианты/категории/состав по-
 * прежнему пусты (только в detail-DTO). Карточке достаточно name/price/image/
 * бейджей/наличия + фасеты для клиентского фильтра каталога.
 */
export function fromListItem(dto: AdmikProductListItemDto): StorefrontProduct {
  return {
    slug: dto.slug,
    name: dto.name,
    price: parseMoney(dto.price),
    oldPrice: parseOldPrice(dto.compareAtPrice),
    discountPct: dto.discountPct,
    onSale: dto.onSale,
    isNew: dto.isNew,
    isBestseller: dto.isFeatured,
    inStock: dto.inStock,
    availableQty: Math.max(0, Math.trunc(dto.availableQty ?? 0)),
    imageUrl: dto.imageUrl,
    images: dto.imageUrl ? [dto.imageUrl] : [],
    brand: dto.brand ? { slug: dto.brand.slug, name: dto.brand.name } : null,
    categories: [],
    // Фасеты: gender резолвим той же логикой, что и в detail (из строки атрибута).
    gender: resolveGender({ gender: dto.gender ?? '' }),
    color: (dto.color ?? '').trim(),
    composition: '',
    care: '',
    features: [],
    description: '',
    variants: [],
    sizes: Array.isArray(dto.sizes) ? dto.sizes : [],
  };
}

/** Полная карточка товара: detail-DTO → StorefrontProduct (атрибуты, варианты, медиа). */
export function fromDetail(dto: AdmikProductDetailDto): StorefrontProduct {
  const variants = sortVariants(
    dto.variants.map(toStorefrontVariant),
  );
  const images = dto.media
    .map((m) => m.url)
    .filter((u): u is string => Boolean(u));

  return {
    id: dto.id,
    slug: dto.slug,
    name: dto.name,
    price: parseMoney(dto.price),
    oldPrice: parseOldPrice(dto.compareAtPrice),
    discountPct: dto.discountPct,
    onSale: dto.onSale,
    isNew: dto.isNew,
    isBestseller: dto.isFeatured,
    inStock: dto.inStock,
    availableQty: Math.max(0, Math.trunc(dto.availableQty ?? 0)),
    imageUrl: images[0] ?? null,
    images,
    brand: dto.brand ? { slug: dto.brand.slug, name: dto.brand.name } : null,
    categories: dto.categories,
    gender: resolveGender(dto.attributes, dto.categories),
    color: readAttrString(dto.attributes, ['color', 'цвет']),
    composition: readAttrString(dto.attributes, ['composition', 'состав']),
    care: readAttrString(dto.attributes, ['care', 'уход']),
    features: readFeatures(dto.attributes),
    description: dto.description,
    variants,
    sizes: variants.map((v) => v.size),
  };
}
