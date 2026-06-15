/**
 * Слой чтения каталога (docs/05 §4.1).
 *
 * Только SELECT через `sql` (tagged templates → параметризация, анти-SQLi).
 * Никаких мутаций здесь — они в actions.ts через defineAction.
 *
 * Маппинг row(snake_case)→domain(camelCase) вынесен в чистые функции map*,
 * экспортируемые для юнит-тестов (БД не нужна).
 */

import { sql } from '@/lib/db/client';
import type {
  Attribute,
  AttributeValue,
  Category,
  CategoryTreeNode,
  InventoryItem,
  Product,
  ProductAttribute,
  ProductDetail,
  ProductListRow,
  ProductMedia,
  ProductStatus,
  ProductVariant,
} from './types';
import type { CategoryEdge } from './tree';

// =============================================================================
// Чистые мапперы row→domain (тестируемы без БД).
// =============================================================================

function asDate(v: any): Date {
  return v instanceof Date ? v : new Date(v);
}
function asJson(v: any): Record<string, unknown> {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export function mapCategory(row: any): Category {
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    sort: Number(row.sort),
    isActive: Boolean(row.is_active),
    seoTitle: row.seo_title ?? null,
    seoDescription: row.seo_description ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export function mapProduct(row: any): Product {
  return {
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    status: row.status as ProductStatus,
    basePrice: String(row.base_price),
    attributesCache: asJson(row.attributes_cache),
    seoTitle: row.seo_title ?? null,
    seoDescription: row.seo_description ?? null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export function mapVariant(row: any): ProductVariant {
  return {
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    name: row.name ?? '',
    priceOverride: row.price_override === null || row.price_override === undefined
      ? null
      : String(row.price_override),
    priceDelta: String(row.price_delta),
    isActive: Boolean(row.is_active),
    sort: Number(row.sort),
    attributesCache: asJson(row.attributes_cache),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export function mapAttribute(row: any): Attribute {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    unit: row.unit ?? null,
    isVariant: Boolean(row.is_variant),
    isFilterable: Boolean(row.is_filterable),
    isRequired: Boolean(row.is_required),
    sort: Number(row.sort),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export function mapAttributeValue(row: any): AttributeValue {
  return {
    id: row.id,
    attributeId: row.attribute_id,
    value: row.value,
    slug: row.slug ?? null,
    sort: Number(row.sort),
  };
}

export function mapProductAttribute(row: any): ProductAttribute {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id ?? null,
    attributeId: row.attribute_id,
    valueId: row.value_id ?? null,
    valueText: row.value_text ?? null,
  };
}

export function mapMedia(row: any): ProductMedia {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id ?? null,
    storageKey: row.storage_key,
    url: row.url ?? null,
    type: row.type,
    mime: row.mime,
    alt: row.alt ?? '',
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    sizeBytes:
      row.size_bytes === null || row.size_bytes === undefined
        ? null
        : Number(row.size_bytes),
    sort: Number(row.sort),
    isPrimary: Boolean(row.is_primary),
    createdAt: asDate(row.created_at),
  };
}

export function mapInventory(row: any): InventoryItem {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id ?? null,
    warehouseCode: row.warehouse_code,
    quantity: Number(row.quantity),
    reserved: Number(row.reserved),
    updatedAt: asDate(row.updated_at),
  };
}

// =============================================================================
// Категории.
// =============================================================================

/** Все рёбра дерева (id→parentId) — для чистой проверки циклов в moveCategory. */
export async function listCategoryEdges(): Promise<CategoryEdge[]> {
  const rows = await sql<{ id: string; parent_id: string | null }[]>`
    SELECT id, parent_id FROM categories
  `;
  return rows.map((r) => ({ id: r.id, parentId: r.parent_id ?? null }));
}

/** Плоский список всех категорий (отсортирован для сборки дерева). */
export async function listCategories(): Promise<Category[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, parent_id, slug, name, description, sort, is_active,
           seo_title, seo_description, created_at, updated_at
    FROM categories
    ORDER BY parent_id NULLS FIRST, sort, name
  `;
  return rows.map(mapCategory);
}

/** Собирает дерево категорий из плоского списка (чистая функция). */
export function buildCategoryTree(categories: Category[]): CategoryTreeNode[] {
  const nodes = new Map<string, CategoryTreeNode>();
  for (const c of categories) {
    nodes.set(c.id, { ...c, children: [] });
  }
  const roots: CategoryTreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Дерево категорий (читает список и собирает иерархию). */
export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  return buildCategoryTree(await listCategories());
}

/** Сколько прямых детей у категории (для проверки RESTRICT-удаления). */
export async function countCategoryChildren(id: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM categories WHERE parent_id = ${id}
  `;
  return Number(rows[0]?.count ?? 0);
}

// =============================================================================
// Товары.
// =============================================================================

export type ProductSort =
  | 'created_desc'
  | 'name_asc'
  | 'price_asc'
  | 'price_desc';

export interface ProductListFilter {
  search?: string;
  status?: ProductStatus;
  categoryId?: string;
  page: number;
  pageSize: number;
  sort?: ProductSort;
}

/**
 * Список товаров с фильтром/поиском(pg_trgm)/пагинацией (§4.1, §5.2).
 * Все условия параметризованы. Поиск — ILIKE по name/sku (GIN/pg_trgm индексы).
 */
export async function listProducts(
  f: ProductListFilter,
): Promise<{ rows: ProductListRow[]; total: number }> {
  const page = Math.max(1, Math.floor(f.page));
  const pageSize = Math.min(200, Math.max(1, Math.floor(f.pageSize)));
  const offset = (page - 1) * pageSize;

  const searchTerm = f.search?.trim() ? `%${f.search.trim()}%` : null;

  // Условия фильтрации — каждое значение параметризовано.
  const where = sql`
    WHERE (${searchTerm}::text IS NULL OR p.name ILIKE ${searchTerm} OR p.sku ILIKE ${searchTerm})
      AND (${f.status ?? null}::text IS NULL OR p.status = ${f.status ?? null})
      AND (${f.categoryId ?? null}::uuid IS NULL OR EXISTS (
            SELECT 1 FROM product_categories pc
            WHERE pc.product_id = p.id AND pc.category_id = ${f.categoryId ?? null}
          ))
  `;

  const orderBy =
    f.sort === 'name_asc'
      ? sql`ORDER BY p.name ASC`
      : f.sort === 'price_asc'
        ? sql`ORDER BY p.base_price ASC`
        : f.sort === 'price_desc'
          ? sql`ORDER BY p.base_price DESC`
          : sql`ORDER BY p.created_at DESC`;

  const rows = await sql<Record<string, unknown>[]>`
    SELECT
      p.id, p.sku, p.slug, p.name, p.status, p.base_price, p.created_at,
      COALESCE((SELECT sum(i.quantity) FROM inventory i WHERE i.product_id = p.id), 0) AS total_stock,
      (SELECT m.url FROM product_media m
        WHERE m.product_id = p.id AND m.is_primary
        LIMIT 1) AS primary_media_url
    FROM products p
    ${where}
    ${orderBy}
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const totalRows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM products p ${where}
  `;

  const mapped: ProductListRow[] = rows.map((r: any) => ({
    id: r.id,
    sku: r.sku,
    slug: r.slug,
    name: r.name,
    status: r.status as ProductStatus,
    basePrice: String(r.base_price),
    totalStock: Number(r.total_stock ?? 0),
    primaryMediaUrl: r.primary_media_url ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));

  return { rows: mapped, total: Number(totalRows[0]?.count ?? 0) };
}

/** Полная карточка товара со связями (§4.1). */
export async function getProductById(
  id: string,
): Promise<ProductDetail | null> {
  const prodRows = await sql<Record<string, unknown>[]>`
    SELECT id, sku, slug, name, description, status, base_price,
           attributes_cache, seo_title, seo_description, created_at, updated_at
    FROM products WHERE id = ${id} LIMIT 1
  `;
  if (!prodRows[0]) {
    return null;
  }
  const product = mapProduct(prodRows[0]);

  const [catRows, variantRows, attrRows, mediaRows, invRows] = await Promise.all([
    sql<{ category_id: string; is_primary: boolean }[]>`
      SELECT category_id, is_primary FROM product_categories WHERE product_id = ${id}
    `,
    sql<Record<string, unknown>[]>`
      SELECT id, product_id, sku, name, price_override, price_delta,
             is_active, sort, attributes_cache, created_at, updated_at
      FROM product_variants WHERE product_id = ${id} ORDER BY sort, name
    `,
    sql<Record<string, unknown>[]>`
      SELECT id, product_id, variant_id, attribute_id, value_id, value_text
      FROM product_attributes WHERE product_id = ${id}
    `,
    sql<Record<string, unknown>[]>`
      SELECT id, product_id, variant_id, storage_key, url, type, mime, alt,
             width, height, size_bytes, sort, is_primary, created_at
      FROM product_media WHERE product_id = ${id} ORDER BY sort, created_at
    `,
    sql<Record<string, unknown>[]>`
      SELECT id, product_id, variant_id, warehouse_code, quantity, reserved, updated_at
      FROM inventory WHERE product_id = ${id}
    `,
  ]);

  return {
    ...product,
    categories: catRows.map((r) => ({
      categoryId: r.category_id,
      isPrimary: Boolean(r.is_primary),
    })),
    variants: variantRows.map(mapVariant),
    attributes: attrRows.map(mapProductAttribute),
    media: mediaRows.map(mapMedia),
    inventory: invRows.map(mapInventory),
  };
}

// =============================================================================
// Характеристики / остатки (точечные чтения для actions/UI).
// =============================================================================

/** Все характеристики справочника. */
export async function listAttributes(): Promise<Attribute[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, code, name, type, unit, is_variant, is_filterable, is_required,
           sort, created_at, updated_at
    FROM attributes ORDER BY sort, name
  `;
  return rows.map(mapAttribute);
}

/** Значения словаря характеристики. */
export async function listAttributeValues(
  attributeId: string,
): Promise<AttributeValue[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, attribute_id, value, slug, sort
    FROM attribute_values WHERE attribute_id = ${attributeId} ORDER BY sort, value
  `;
  return rows.map(mapAttributeValue);
}

/** Остатки товара (все строки inventory). */
export async function listInventory(
  productId: string,
): Promise<InventoryItem[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, product_id, variant_id, warehouse_code, quantity, reserved, updated_at
    FROM inventory WHERE product_id = ${productId}
  `;
  return rows.map(mapInventory);
}
