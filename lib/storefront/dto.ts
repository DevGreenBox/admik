/**
 * Публичные DTO Storefront API + чистые мапперы из доменных типов каталога
 * (docs/06 §6, ADR-008).
 *
 * ПРИНЦИП: витрине отдаём ТОЛЬКО публично-безопасные поля. НЕ раскрываем:
 *  - status товара (draft/archived вообще не должны попадать в выдачу — фильтр
 *    на уровне запроса), внутренние id связей, attributes_cache как сырой объект,
 *    storage_key медиа, точные остатки inventory.
 *  - вместо точного остатка отдаём `inStock: boolean` (inventory.quantity > 0).
 *    ОБОСНОВАНИЕ: точный остаток — коммерчески чувствительная информация (даёт
 *    конкуренту оценку оборота/закупок); витрине для кнопки «В корзину» достаточно
 *    булева «в наличии». При необходимости порога low-stock — отдельное решение.
 *
 * Цена/скидка отдаются ГОТОВЫМИ: discountPct и onSale вычисляются переиспользуемыми
 * функциями lib/catalog/pricing (без дублирования логики).
 *
 * Чистые функции — тестируемы без БД/Next.
 */

import { discountPercent, isOnSale, effectiveCompareAt } from '@/lib/catalog/pricing';
import type {
  Brand,
  BrandRef,
  Category,
  CategoryTreeNode,
  InventoryItem,
  ProductDetail,
  ProductListRow,
  ProductMedia,
  ProductVariant,
} from '@/lib/catalog/types';

// ---------------------------------------------------------------------------
// Типы публичных DTO.
// ---------------------------------------------------------------------------

export interface BrandDto {
  slug: string;
  name: string;
  logoUrl: string | null;
}

export interface FullBrandDto extends BrandDto {
  description: string;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface CategoryDto {
  slug: string;
  name: string;
  description: string;
  children: CategoryDto[];
}

export interface MediaDto {
  url: string | null;
  type: string;
  alt: string;
  isPrimary: boolean;
}

export interface VariantDto {
  id: string;
  sku: string;
  /** Эффективная цена варианта как строка NUMERIC (точность не теряется). */
  price: string;
  compareAtPrice: string | null;
  discountPct: number | null;
  onSale: boolean;
  /** Публичные атрибуты варианта (denormalized cache — без внутренних id). */
  attributes: Record<string, unknown>;
  /** В наличии (inventory > 0). Точный остаток НЕ раскрывается. */
  inStock: boolean;
}

export interface ProductListItemDto {
  slug: string;
  name: string;
  price: string;
  compareAtPrice: string | null;
  discountPct: number | null;
  onSale: boolean;
  isNew: boolean;
  isFeatured: boolean;
  brand: BrandDto | null;
  imageUrl: string | null;
  inStock: boolean;
}

export interface ProductDetailDto {
  slug: string;
  sku: string;
  name: string;
  description: string;
  price: string;
  compareAtPrice: string | null;
  discountPct: number | null;
  onSale: boolean;
  isNew: boolean;
  isFeatured: boolean;
  brand: BrandDto | null;
  categories: string[];
  attributes: Record<string, unknown>;
  variants: VariantDto[];
  media: MediaDto[];
  inStock: boolean;
}

// ---------------------------------------------------------------------------
// Мапперы.
// ---------------------------------------------------------------------------

/** Бренд-ref → публичный BrandDto (только name/slug/logo). */
export function toBrandDto(brand: BrandRef | null): BrandDto | null {
  if (!brand) {
    return null;
  }
  return {
    slug: brand.slug,
    name: brand.name,
    logoUrl: brand.logoUrl ?? null,
  };
}

/** Полный бренд → публичный FullBrandDto (для /brands). Внутренние поля скрыты. */
export function toFullBrandDto(brand: Brand): FullBrandDto {
  return {
    slug: brand.slug,
    name: brand.name,
    logoUrl: brand.logoUrl ?? null,
    description: brand.description,
    seoTitle: brand.seoTitle,
    seoDescription: brand.seoDescription,
  };
}

/** Узел дерева категорий (или плоская категория) → CategoryDto, рекурсивно. */
export function toCategoryDto(node: CategoryTreeNode | Category): CategoryDto {
  const children = 'children' in node && Array.isArray(node.children) ? node.children : [];
  return {
    slug: node.slug,
    name: node.name,
    description: node.description,
    children: children.map(toCategoryDto),
  };
}

/** Дерево категорий → DTO, скрывая неактивные ветви. */
export function toCategoryTreeDto(tree: CategoryTreeNode[]): CategoryDto[] {
  return tree
    .filter((n) => n.isActive)
    .map((n) => ({
      slug: n.slug,
      name: n.name,
      description: n.description,
      children: toCategoryTreeDto(n.children),
    }));
}

/** Строка списка товаров → публичный DTO (price/скидка готовы). */
export function toProductListItemDto(
  row: ProductListRow,
): ProductListItemDto {
  return {
    slug: row.slug,
    name: row.name,
    price: row.basePrice,
    compareAtPrice: row.compareAtPrice,
    discountPct: row.discountPct,
    onSale: row.onSale,
    isNew: row.effectiveIsNew,
    isFeatured: row.isFeatured,
    brand: toBrandDto(row.brand),
    imageUrl: row.primaryMediaUrl,
    inStock: row.totalStock > 0,
  };
}

/** Медиа → публичный DTO (без storage_key/размеров/байт). */
export function toMediaDto(media: ProductMedia): MediaDto {
  return {
    url: media.url,
    type: media.type,
    alt: media.alt,
    isPrimary: media.isPrimary,
  };
}

/** Считает «в наличии» по строкам inventory (опц. фильтр по варианту). */
export function computeInStock(
  inventory: InventoryItem[],
  variantId?: string | null,
): boolean {
  return inventory.some(
    (i) =>
      i.quantity > 0 &&
      (variantId === undefined || (i.variantId ?? null) === (variantId ?? null)),
  );
}

/**
 * Эффективная цена варианта как строка: priceOverride, иначе basePrice+priceDelta.
 * Деньги — строки NUMERIC; складываем через число, форматируем 2 знака.
 */
export function effectiveVariantPrice(
  variant: ProductVariant,
  basePrice: string,
): string {
  if (variant.priceOverride !== null && variant.priceOverride !== undefined) {
    return variant.priceOverride;
  }
  const base = Number(basePrice);
  const delta = Number(variant.priceDelta ?? '0');
  if (!Number.isFinite(base) || !Number.isFinite(delta)) {
    return basePrice;
  }
  return (base + delta).toFixed(2);
}

/** Вариант → публичный DTO (цена/скидка/inStock). */
export function toVariantDto(
  variant: ProductVariant,
  product: ProductDetail,
): VariantDto {
  const price = effectiveVariantPrice(variant, product.basePrice);
  const compareAt = effectiveCompareAt(
    variant.compareAtPrice,
    product.compareAtPrice,
  );
  const compareAtStr = compareAt !== null ? compareAt.toFixed(2) : null;
  return {
    id: variant.id,
    sku: variant.sku,
    price,
    compareAtPrice: compareAtStr,
    discountPct: discountPercent(price, compareAtStr),
    onSale: isOnSale(price, compareAtStr),
    attributes: variant.attributesCache ?? {},
    inStock: computeInStock(product.inventory, variant.id),
  };
}

/**
 * Полная карточка товара → публичный DTO.
 *
 * effectiveIsNew — вычисленная «новизна» (троичная логика). Поскольку
 * ProductDetail хранит сырой `isNew`, передаём готовое значение параметром
 * (роут вычисляет через resolveIsNew с настройкой магазина).
 */
export function toProductDetailDto(
  product: ProductDetail,
  opts: { effectiveIsNew: boolean; categorySlugs: string[] },
): ProductDetailDto {
  return {
    slug: product.slug,
    sku: product.sku,
    name: product.name,
    description: product.description,
    price: product.basePrice,
    compareAtPrice: product.compareAtPrice,
    discountPct: discountPercent(product.basePrice, product.compareAtPrice),
    onSale: isOnSale(product.basePrice, product.compareAtPrice),
    isNew: opts.effectiveIsNew,
    isFeatured: product.isFeatured,
    brand: toBrandDto(product.brand),
    categories: opts.categorySlugs,
    attributes: product.attributesCache ?? {},
    variants: product.variants
      .filter((v) => v.isActive)
      .map((v) => toVariantDto(v, product)),
    media: product.media.map(toMediaDto),
    inStock: computeInStock(product.inventory),
  };
}
