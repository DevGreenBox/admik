/**
 * Доменные типы каталога (docs/05 §2 «Схема БД»).
 *
 * Это типы прикладного уровня (camelCase), отображающие строки таблиц каталога.
 * Маппинг row(snake_case)→domain(camelCase) — в repository.ts (функции map*).
 * Деньги моделируются строкой (NUMERIC(14,2) приходит из postgres.js строкой,
 * чтобы не терять точность); парсинг в число — на уровне представления.
 */

// -----------------------------------------------------------------------------
// Перечисления / литеральные типы (соответствуют CHECK-ограничениям в БД).
// -----------------------------------------------------------------------------

/** Жизненный цикл товара (products.status). */
export type ProductStatus = 'draft' | 'active' | 'archived';
export const PRODUCT_STATUSES: readonly ProductStatus[] = [
  'draft',
  'active',
  'archived',
] as const;

/** Тип значения характеристики (attributes.type). */
export type AttributeType = 'select' | 'text' | 'number' | 'boolean';
export const ATTRIBUTE_TYPES: readonly AttributeType[] = [
  'select',
  'text',
  'number',
  'boolean',
] as const;

/** Тип медиа (product_media.type). */
export type MediaType = 'image' | 'video' | 'document';
export const MEDIA_TYPES: readonly MediaType[] = [
  'image',
  'video',
  'document',
] as const;

// -----------------------------------------------------------------------------
// Сущности.
// -----------------------------------------------------------------------------

/** Категория дерева (categories). */
export interface Category {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  description: string;
  sort: number;
  isActive: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Узел дерева категорий с детьми (для рендера дерева). */
export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

/** Товар (products). */
export interface Product {
  id: string;
  sku: string;
  slug: string;
  name: string;
  description: string;
  status: ProductStatus;
  /** NUMERIC(14,2) как строка — точность не теряется. */
  basePrice: string;
  /** Денормализованная проекция характеристик (ADR-007). */
  attributesCache: Record<string, unknown>;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Вариант товара (product_variants). */
export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  name: string;
  /** Абсолютная цена варианта; null → берётся basePrice (+delta). */
  priceOverride: string | null;
  /** Надбавка к basePrice. */
  priceDelta: string;
  isActive: boolean;
  sort: number;
  attributesCache: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Метаданные характеристики-справочника (attributes). */
export interface Attribute {
  id: string;
  code: string;
  name: string;
  type: AttributeType;
  unit: string | null;
  isVariant: boolean;
  isFilterable: boolean;
  isRequired: boolean;
  sort: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Значение из словаря характеристики (attribute_values). */
export interface AttributeValue {
  id: string;
  attributeId: string;
  value: string;
  slug: string | null;
  sort: number;
}

/** Привязка характеристики к товару/варианту (product_attributes). */
export interface ProductAttribute {
  id: string;
  productId: string;
  variantId: string | null;
  attributeId: string;
  valueId: string | null;
  valueText: string | null;
}

/** Медиафайл товара/варианта (product_media). */
export interface ProductMedia {
  id: string;
  productId: string;
  variantId: string | null;
  storageKey: string;
  url: string | null;
  type: MediaType;
  mime: string;
  alt: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  sort: number;
  isPrimary: boolean;
  createdAt: Date;
}

/** Остаток (inventory). */
export interface InventoryItem {
  id: string;
  productId: string;
  variantId: string | null;
  warehouseCode: string;
  quantity: number;
  reserved: number;
  updatedAt: Date;
}

/**
 * Товар с присоединёнными связями — результат getProductById (§4.1).
 */
export interface ProductDetail extends Product {
  categories: Array<{ categoryId: string; isPrimary: boolean }>;
  variants: ProductVariant[];
  attributes: ProductAttribute[];
  media: ProductMedia[];
  inventory: InventoryItem[];
}

/** Строка списка товаров (компактная проекция для таблицы админки). */
export interface ProductListRow {
  id: string;
  sku: string;
  slug: string;
  name: string;
  status: ProductStatus;
  basePrice: string;
  /** Суммарный остаток по всем строкам inventory товара. */
  totalStock: number;
  /** URL главного изображения (is_primary), если есть. */
  primaryMediaUrl: string | null;
  createdAt: Date;
}
