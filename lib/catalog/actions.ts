'use server';

import { defineAction, type ActionCtx } from '@/lib/server/action';
import { sql } from '@/lib/db/client';
import { isModuleEnabled } from '@/lib/config/modules';
import { getStorage } from '@/lib/storage';
import { validateUpload } from '@/lib/storage/validate';
import { generatePreviews } from '@/lib/storage/image';

import {
  CategoryCreateSchema,
  CategoryUpdateSchema,
  CategoryMoveSchema,
  CategoryDeleteSchema,
  ProductCreateSchema,
  ProductUpdateSchema,
  ProductIdSchema,
  VariantCreateSchema,
  VariantUpdateSchema,
  VariantIdSchema,
  AttributeCreateSchema,
  AttributeUpdateSchema,
  AttributeValueSchema,
  SetProductAttributesSchema,
  MediaUploadSchema,
  MediaDeleteSchema,
  MediaReorderSchema,
  StockSetSchema,
  StockAdjustSchema,
  BrandCreateSchema,
  BrandUpdateSchema,
  BrandIdSchema,
  BrandLogoUploadSchema,
} from './schemas';
import { listCategoryEdges, countCategoryChildren } from './repository';
import { CatalogError } from './errors';
import { canMoveCategory } from './tree';
import { rebuildProductAttributesCache } from './cache';
import { slugify, uniquifySlug } from './slug';

/**
 * Server Actions каталога (docs/05 §4).
 *
 * Все мутации — через единый пайплайн defineAction (§4.7 ядра): guard
 * (catalog.write) → Zod → handler (БД через sql, параметризовано) → revalidate
 * → audit. Чувствительных полей у каталога нет, но паттерн соблюдается полностью.
 *
 * Флаг модуля: каждый handler в начале проверяет isModuleEnabled('catalog') и
 * отклоняет вызов при выключенном модуле (помимо скрытия в UI, docs/05 §4).
 */

// -----------------------------------------------------------------------------
// Общие хелперы.
// -----------------------------------------------------------------------------

/** Бросает, если модуль каталога выключен. */
function assertCatalogEnabled(): void {
  if (!isModuleEnabled('catalog')) {
    throw new CatalogError('module_disabled', 'Модуль «Каталог» выключен.');
  }
}

/** Код нарушения уникальности PostgreSQL. */
const PG_UNIQUE_VIOLATION = '23505';

/** true, если ошибка — нарушение уникального индекса. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}

/** Пути инвалидации каталога. */
const CATALOG_LIST_PATH = '/admin/catalog';
function productPath(id: string): string {
  return `/admin/catalog/${id}`;
}
const CATEGORIES_PATH = '/admin/catalog/categories';
const ATTRIBUTES_PATH = '/admin/catalog/attributes';
const BRANDS_PATH = '/admin/catalog/brands';
function brandPath(id: string): string {
  return `/admin/catalog/brands/${id}`;
}
/** Карта сайта — инвалидируется при изменении SEO/публикации сущностей (docs/11 §5.3). */
const SITEMAP_PATH = '/sitemap.xml';

/**
 * Вставляет строку с ретраем slug при коллизии уникального индекса.
 * `insert(slug)` должна вернуть строку результата или бросить ошибку уникальности.
 */
async function insertWithUniqueSlug<T>(
  baseSlug: string,
  insert: (slug: string) => Promise<T>,
  maxAttempts = 6,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = uniquifySlug(baseSlug, attempt);
    try {
      return await insert(candidate);
    } catch (err) {
      if (isUniqueViolation(err) && attempt < maxAttempts - 1) {
        continue;
      }
      throw err;
    }
  }
  throw new CatalogError('slug_conflict', 'Не удалось подобрать уникальный slug.');
}

// =============================================================================
// КАТЕГОРИИ (§4.3).
// =============================================================================

export const createCategory = defineAction({
  permission: 'catalog.write',
  input: CategoryCreateSchema,
  handler: async (data, _ctx: ActionCtx) => {
    assertCatalogEnabled();
    const base = data.slug || slugify(data.name);

    const row = await insertWithUniqueSlug(base, async (slug) => {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO categories
          (parent_id, slug, name, description, sort, is_active, seo_title, seo_description)
        VALUES (
          ${data.parentId ?? null}, ${slug}, ${data.name}, ${data.description ?? ''},
          ${data.sort ?? 0}, ${data.isActive ?? true},
          ${data.seoTitle ?? null}, ${data.seoDescription ?? null}
        )
        RETURNING id
      `;
      return rows[0]!;
    });

    return {
      result: { id: row.id },
      revalidate: [CATEGORIES_PATH, CATALOG_LIST_PATH],
      audit: {
        action: 'catalog.category.create',
        entityType: 'category',
        entityId: row.id,
        after: { slug: base, name: data.name, parentId: data.parentId ?? null },
      },
    };
  },
});

export const updateCategory = defineAction({
  permission: 'catalog.write',
  input: CategoryUpdateSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const before = await sql<Record<string, unknown>[]>`
      SELECT * FROM categories WHERE id = ${data.id} LIMIT 1
    `;
    if (!before[0]) {
      throw new CatalogError('not_found', 'Категория не найдена.');
    }
    const after = await sql<Record<string, unknown>[]>`
      UPDATE categories SET
        slug            = COALESCE(${data.slug ?? null}, slug),
        name            = COALESCE(${data.name ?? null}, name),
        description     = COALESCE(${data.description ?? null}, description),
        sort            = COALESCE(${data.sort ?? null}, sort),
        is_active       = COALESCE(${data.isActive ?? null}, is_active),
        seo_title       = COALESCE(${data.seoTitle ?? null}, seo_title),
        seo_description = COALESCE(${data.seoDescription ?? null}, seo_description),
        og_title        = CASE WHEN ${data.ogTitle !== undefined}
                               THEN ${data.ogTitle ?? null} ELSE og_title END,
        og_description  = CASE WHEN ${data.ogDescription !== undefined}
                               THEN ${data.ogDescription ?? null} ELSE og_description END,
        og_image_key    = CASE WHEN ${data.ogImageKey !== undefined}
                               THEN ${data.ogImageKey ?? null} ELSE og_image_key END,
        canonical_url   = CASE WHEN ${data.canonicalUrl !== undefined}
                               THEN ${data.canonicalUrl ?? null} ELSE canonical_url END,
        noindex         = COALESCE(${data.noindex ?? null}, noindex),
        updated_at      = now()
      WHERE id = ${data.id}
      RETURNING *
    `;
    return {
      result: { id: data.id },
      revalidate: [CATEGORIES_PATH, SITEMAP_PATH],
      audit: {
        action: 'catalog.category.update',
        entityType: 'category',
        entityId: data.id,
        before: before[0],
        after: after[0],
      },
    };
  },
});

export const moveCategory = defineAction({
  permission: 'catalog.write',
  input: CategoryMoveSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    // Защита от цикла: новый родитель не должен входить в поддерево узла.
    const edges = await listCategoryEdges();
    if (!canMoveCategory(edges, data.id, data.parentId)) {
      throw new CatalogError(
        'cycle',
        'Нельзя переместить категорию внутрь её собственного поддерева.',
      );
    }
    const after = await sql<Record<string, unknown>[]>`
      UPDATE categories SET
        parent_id = ${data.parentId},
        sort      = COALESCE(${data.sort ?? null}, sort),
        updated_at = now()
      WHERE id = ${data.id}
      RETURNING id, parent_id, sort
    `;
    if (!after[0]) {
      throw new CatalogError('not_found', 'Категория не найдена.');
    }
    return {
      result: { id: data.id },
      revalidate: [CATEGORIES_PATH],
      audit: {
        action: 'catalog.category.move',
        entityType: 'category',
        entityId: data.id,
        after: { parentId: data.parentId, sort: data.sort },
      },
    };
  },
});

export const deleteCategory = defineAction({
  permission: 'catalog.write',
  input: CategoryDeleteSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    // RESTRICT: запрет удаления категории с детьми (понятная ошибка до БД-уровня).
    const children = await countCategoryChildren(data.id);
    if (children > 0) {
      throw new CatalogError(
        'has_children',
        'Нельзя удалить категорию с подкатегориями — сначала перенесите/удалите детей.',
      );
    }
    const deleted = await sql<{ id: string }[]>`
      DELETE FROM categories WHERE id = ${data.id} RETURNING id
    `;
    if (!deleted[0]) {
      throw new CatalogError('not_found', 'Категория не найдена.');
    }
    return {
      result: { id: data.id },
      revalidate: [CATEGORIES_PATH, CATALOG_LIST_PATH],
      audit: {
        action: 'catalog.category.delete',
        entityType: 'category',
        entityId: data.id,
      },
    };
  },
});

// =============================================================================
// ТОВАРЫ (§4.2).
// =============================================================================

/** Пересобирает product_categories товара из списка id + основной категории. */
async function syncProductCategories(
  productId: string,
  categoryIds: string[] | undefined,
  primaryCategoryId: string | null | undefined,
): Promise<void> {
  if (categoryIds === undefined) {
    return;
  }
  await sql`DELETE FROM product_categories WHERE product_id = ${productId}`;
  for (const categoryId of categoryIds) {
    await sql`
      INSERT INTO product_categories (product_id, category_id, is_primary)
      VALUES (${productId}, ${categoryId}, ${categoryId === primaryCategoryId})
      ON CONFLICT (product_id, category_id) DO UPDATE
        SET is_primary = EXCLUDED.is_primary
    `;
  }
}

export const createProduct = defineAction({
  permission: 'catalog.write',
  input: ProductCreateSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const base = data.slug || slugify(data.name);

    const row = await insertWithUniqueSlug(base, async (slug) => {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO products (sku, slug, name, description, status, base_price,
                              compare_at_price, is_featured, is_new, brand_id,
                              seo_title, seo_description,
                              weight_g, length_cm, width_cm, height_cm)
        VALUES (
          ${data.sku}, ${slug}, ${data.name}, ${data.description ?? ''},
          ${data.status ?? 'draft'}, ${data.basePrice ?? '0'},
          ${data.compareAtPrice ?? null}, ${data.isFeatured ?? false},
          ${data.isNew ?? null}, ${data.brandId ?? null},
          ${data.seoTitle ?? null}, ${data.seoDescription ?? null},
          ${data.weightG ?? null}, ${data.lengthCm ?? null},
          ${data.widthCm ?? null}, ${data.heightCm ?? null}
        )
        RETURNING id
      `;
      return rows[0]!;
    });

    await syncProductCategories(
      row.id,
      data.categoryIds,
      data.primaryCategoryId ?? null,
    );

    return {
      result: { id: row.id },
      revalidate: [CATALOG_LIST_PATH, productPath(row.id)],
      audit: {
        action: 'catalog.product.create',
        entityType: 'product',
        entityId: row.id,
        after: { sku: data.sku, slug: base, name: data.name, status: data.status },
      },
    };
  },
});

export const updateProduct = defineAction({
  permission: 'catalog.write',
  input: ProductUpdateSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const before = await sql<Record<string, unknown>[]>`
      SELECT * FROM products WHERE id = ${data.id} LIMIT 1
    `;
    if (!before[0]) {
      throw new CatalogError('not_found', 'Товар не найден.');
    }

    const after = await sql<Record<string, unknown>[]>`
      UPDATE products SET
        sku             = COALESCE(${data.sku ?? null}, sku),
        slug            = COALESCE(${data.slug ?? null}, slug),
        name            = COALESCE(${data.name ?? null}, name),
        description     = COALESCE(${data.description ?? null}, description),
        status          = COALESCE(${data.status ?? null}, status),
        base_price      = COALESCE(${data.basePrice ?? null}, base_price),
        compare_at_price = CASE WHEN ${data.compareAtPrice !== undefined}
                                THEN ${data.compareAtPrice ?? null} ELSE compare_at_price END,
        is_featured     = COALESCE(${data.isFeatured ?? null}, is_featured),
        is_new          = CASE WHEN ${data.isNew !== undefined}
                               THEN ${data.isNew ?? null} ELSE is_new END,
        brand_id        = CASE WHEN ${data.brandId !== undefined}
                               THEN ${data.brandId ?? null} ELSE brand_id END,
        seo_title       = COALESCE(${data.seoTitle ?? null}, seo_title),
        seo_description = COALESCE(${data.seoDescription ?? null}, seo_description),
        og_title        = CASE WHEN ${data.ogTitle !== undefined}
                               THEN ${data.ogTitle ?? null} ELSE og_title END,
        og_description  = CASE WHEN ${data.ogDescription !== undefined}
                               THEN ${data.ogDescription ?? null} ELSE og_description END,
        og_image_key    = CASE WHEN ${data.ogImageKey !== undefined}
                               THEN ${data.ogImageKey ?? null} ELSE og_image_key END,
        canonical_url   = CASE WHEN ${data.canonicalUrl !== undefined}
                               THEN ${data.canonicalUrl ?? null} ELSE canonical_url END,
        noindex         = COALESCE(${data.noindex ?? null}, noindex),
        weight_g        = CASE WHEN ${data.weightG !== undefined}
                               THEN ${data.weightG ?? null} ELSE weight_g END,
        length_cm       = CASE WHEN ${data.lengthCm !== undefined}
                               THEN ${data.lengthCm ?? null} ELSE length_cm END,
        width_cm        = CASE WHEN ${data.widthCm !== undefined}
                               THEN ${data.widthCm ?? null} ELSE width_cm END,
        height_cm       = CASE WHEN ${data.heightCm !== undefined}
                               THEN ${data.heightCm ?? null} ELSE height_cm END,
        updated_at      = now()
      WHERE id = ${data.id}
      RETURNING *
    `;

    await syncProductCategories(
      data.id,
      data.categoryIds,
      data.primaryCategoryId ?? null,
    );

    return {
      result: { id: data.id },
      revalidate: [CATALOG_LIST_PATH, productPath(data.id), SITEMAP_PATH],
      audit: {
        action: 'catalog.product.update',
        entityType: 'product',
        entityId: data.id,
        before: before[0],
        after: after[0],
      },
    };
  },
});

export const archiveProduct = defineAction({
  permission: 'catalog.write',
  input: ProductIdSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const rows = await sql<{ id: string; status: string }[]>`
      UPDATE products SET status = 'archived', updated_at = now()
      WHERE id = ${data.id}
      RETURNING id, status
    `;
    if (!rows[0]) {
      throw new CatalogError('not_found', 'Товар не найден.');
    }
    return {
      result: { id: data.id },
      revalidate: [CATALOG_LIST_PATH, productPath(data.id)],
      audit: {
        action: 'catalog.product.archive',
        entityType: 'product',
        entityId: data.id,
        after: { status: 'archived' },
      },
    };
  },
});

// =============================================================================
// ВАРИАНТЫ (§4.4).
// =============================================================================

export const createVariant = defineAction({
  permission: 'catalog.write',
  input: VariantCreateSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO product_variants
        (product_id, sku, name, price_override, price_delta, compare_at_price, is_active, sort,
         weight_g, length_cm, width_cm, height_cm)
      VALUES (
        ${data.productId}, ${data.sku}, ${data.name ?? ''},
        ${data.priceOverride ?? null}, ${data.priceDelta ?? '0'},
        ${data.compareAtPrice ?? null}, ${data.isActive ?? true}, ${data.sort ?? 0},
        ${data.weightG ?? null}, ${data.lengthCm ?? null},
        ${data.widthCm ?? null}, ${data.heightCm ?? null}
      )
      RETURNING id
    `;
    const variantId = rows[0]!.id;
    // Инициализируем остаток варианта нулём (§4.4).
    await sql`
      INSERT INTO inventory (product_id, variant_id, warehouse_code, quantity)
      VALUES (${data.productId}, ${variantId}, 'main', 0)
      ON CONFLICT DO NOTHING
    `;
    return {
      result: { id: variantId },
      revalidate: [productPath(data.productId)],
      audit: {
        action: 'catalog.variant.create',
        entityType: 'product_variant',
        entityId: variantId,
        after: { productId: data.productId, sku: data.sku },
      },
    };
  },
});

export const updateVariant = defineAction({
  permission: 'catalog.write',
  input: VariantUpdateSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const before = await sql<Record<string, unknown>[]>`
      SELECT * FROM product_variants WHERE id = ${data.id} LIMIT 1
    `;
    if (!before[0]) {
      throw new CatalogError('not_found', 'Вариант не найден.');
    }
    const after = await sql<Record<string, unknown>[]>`
      UPDATE product_variants SET
        sku            = COALESCE(${data.sku ?? null}, sku),
        name           = COALESCE(${data.name ?? null}, name),
        price_override = CASE WHEN ${data.priceOverride !== undefined}
                              THEN ${data.priceOverride ?? null} ELSE price_override END,
        price_delta    = COALESCE(${data.priceDelta ?? null}, price_delta),
        compare_at_price = CASE WHEN ${data.compareAtPrice !== undefined}
                                THEN ${data.compareAtPrice ?? null} ELSE compare_at_price END,
        is_active      = COALESCE(${data.isActive ?? null}, is_active),
        sort           = COALESCE(${data.sort ?? null}, sort),
        weight_g       = CASE WHEN ${data.weightG !== undefined}
                              THEN ${data.weightG ?? null} ELSE weight_g END,
        length_cm      = CASE WHEN ${data.lengthCm !== undefined}
                              THEN ${data.lengthCm ?? null} ELSE length_cm END,
        width_cm       = CASE WHEN ${data.widthCm !== undefined}
                              THEN ${data.widthCm ?? null} ELSE width_cm END,
        height_cm      = CASE WHEN ${data.heightCm !== undefined}
                              THEN ${data.heightCm ?? null} ELSE height_cm END,
        updated_at     = now()
      WHERE id = ${data.id}
      RETURNING *
    `;
    return {
      result: { id: data.id },
      revalidate: [productPath(String(before[0].product_id))],
      audit: {
        action: 'catalog.variant.update',
        entityType: 'product_variant',
        entityId: data.id,
        before: before[0],
        after: after[0],
      },
    };
  },
});

export const deleteVariant = defineAction({
  permission: 'catalog.write',
  input: VariantIdSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const rows = await sql<{ id: string; product_id: string }[]>`
      DELETE FROM product_variants WHERE id = ${data.id}
      RETURNING id, product_id
    `;
    if (!rows[0]) {
      throw new CatalogError('not_found', 'Вариант не найден.');
    }
    return {
      result: { id: data.id },
      revalidate: [productPath(rows[0].product_id)],
      audit: {
        action: 'catalog.variant.delete',
        entityType: 'product_variant',
        entityId: data.id,
      },
    };
  },
});

// =============================================================================
// ХАРАКТЕРИСТИКИ (§4.5).
// =============================================================================

export const createAttribute = defineAction({
  permission: 'catalog.write',
  input: AttributeCreateSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO attributes
        (code, name, type, unit, is_variant, is_filterable, is_required, sort)
      VALUES (
        ${data.code}, ${data.name}, ${data.type ?? 'select'}, ${data.unit ?? null},
        ${data.isVariant ?? false}, ${data.isFilterable ?? true},
        ${data.isRequired ?? false}, ${data.sort ?? 0}
      )
      RETURNING id
    `;
    return {
      result: { id: rows[0]!.id },
      revalidate: [ATTRIBUTES_PATH],
      audit: {
        action: 'catalog.attribute.create',
        entityType: 'attribute',
        entityId: rows[0]!.id,
        after: { code: data.code, name: data.name, type: data.type },
      },
    };
  },
});

export const updateAttribute = defineAction({
  permission: 'catalog.write',
  input: AttributeUpdateSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const before = await sql<Record<string, unknown>[]>`
      SELECT * FROM attributes WHERE id = ${data.id} LIMIT 1
    `;
    if (!before[0]) {
      throw new CatalogError('not_found', 'Характеристика не найдена.');
    }
    const after = await sql<Record<string, unknown>[]>`
      UPDATE attributes SET
        name          = COALESCE(${data.name ?? null}, name),
        type          = COALESCE(${data.type ?? null}, type),
        unit          = CASE WHEN ${data.unit !== undefined}
                             THEN ${data.unit ?? null} ELSE unit END,
        is_variant    = COALESCE(${data.isVariant ?? null}, is_variant),
        is_filterable = COALESCE(${data.isFilterable ?? null}, is_filterable),
        is_required   = COALESCE(${data.isRequired ?? null}, is_required),
        sort          = COALESCE(${data.sort ?? null}, sort),
        updated_at    = now()
      WHERE id = ${data.id}
      RETURNING *
    `;
    return {
      result: { id: data.id },
      revalidate: [ATTRIBUTES_PATH],
      audit: {
        action: 'catalog.attribute.update',
        entityType: 'attribute',
        entityId: data.id,
        before: before[0],
        after: after[0],
      },
    };
  },
});

export const addAttributeValue = defineAction({
  permission: 'catalog.write',
  input: AttributeValueSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO attribute_values (attribute_id, value, slug, sort)
      VALUES (${data.attributeId}, ${data.value}, ${data.slug ?? null}, ${data.sort ?? 0})
      RETURNING id
    `;
    return {
      result: { id: rows[0]!.id },
      revalidate: [ATTRIBUTES_PATH],
      audit: {
        action: 'catalog.attribute_value.create',
        entityType: 'attribute_value',
        entityId: rows[0]!.id,
        after: { attributeId: data.attributeId, value: data.value },
      },
    };
  },
});

export const setProductAttributes = defineAction({
  permission: 'catalog.write',
  input: SetProductAttributesSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    // Полная замена привязок уровня товара (variant_id IS NULL) и переданных вариантов.
    await sql`
      DELETE FROM product_attributes
      WHERE product_id = ${data.productId} AND variant_id IS NULL
    `;
    for (const item of data.items) {
      await sql`
        INSERT INTO product_attributes
          (product_id, variant_id, attribute_id, value_id, value_text)
        VALUES (
          ${data.productId}, ${item.variantId ?? null}, ${item.attributeId},
          ${item.valueId ?? null}, ${item.valueText ?? null}
        )
        ON CONFLICT DO NOTHING
      `;
    }
    // Пересбор презентационного кеша (ADR-007, cache.ts).
    const cache = await rebuildProductAttributesCache(data.productId);
    return {
      result: { productId: data.productId, cache },
      revalidate: [productPath(data.productId)],
      audit: {
        action: 'catalog.product.attributes.set',
        entityType: 'product',
        entityId: data.productId,
        after: { count: data.items.length },
      },
    };
  },
});

// =============================================================================
// МЕДИА (§4.6, §3.4).
// =============================================================================

export const attachMedia = defineAction({
  permission: 'catalog.write',
  input: MediaUploadSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();

    // (2) Валидация magic-bytes + лимиты (storage/validate).
    const validation = await validateUpload(data.bytes, data.filename);
    if (!validation.ok || !validation.mime) {
      throw new CatalogError('invalid_media', validation.error ?? 'Недопустимый файл.');
    }

    // (3) Превью/размеры через sharp (для изображений).
    const previews = await generatePreviews(data.bytes);
    const main = previews.main;

    // (4) Загрузка в хранилище (S3 или local mock). Ключ генерируем сервером.
    const storage = getStorage();
    const key = `products/${data.productId}/${crypto.randomUUID()}.webp`;
    let put;
    try {
      put = await storage.put(key, main.buffer, 'image/webp');
    } catch {
      throw new CatalogError('storage_failed', 'Не удалось сохранить файл в хранилище.');
    }

    // (5) Запись метаданных. Компенсация при сбое INSERT — удалить объект (§3.4 шаг 7).
    let inserted;
    try {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO product_media
          (product_id, variant_id, storage_key, url, type, mime, alt,
           width, height, size_bytes, is_primary)
        VALUES (
          ${data.productId}, ${data.variantId ?? null}, ${put.key}, ${put.url},
          ${data.type ?? 'image'}, ${'image/webp'}, ${data.alt ?? ''},
          ${main.width}, ${main.height}, ${put.size}, ${data.isPrimary ?? false}
        )
        RETURNING id
      `;
      inserted = rows[0]!;
    } catch (err) {
      await storage.delete(put.key).catch(() => {});
      throw err;
    }

    return {
      result: { id: inserted.id, url: put.url, key: put.key },
      revalidate: [productPath(data.productId)],
      audit: {
        action: 'catalog.media.upload',
        entityType: 'product_media',
        entityId: inserted.id,
        after: { productId: data.productId, mime: 'image/webp', key: put.key },
      },
    };
  },
});

export const deleteMedia = defineAction({
  permission: 'catalog.write',
  input: MediaDeleteSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const rows = await sql<{ id: string; product_id: string; storage_key: string }[]>`
      DELETE FROM product_media WHERE id = ${data.id}
      RETURNING id, product_id, storage_key
    `;
    if (!rows[0]) {
      throw new CatalogError('not_found', 'Медиа не найдено.');
    }
    // Физическое удаление объекта в хранилище (§4.6).
    await getStorage().delete(rows[0].storage_key).catch(() => {});
    return {
      result: { id: data.id },
      revalidate: [productPath(rows[0].product_id)],
      audit: {
        action: 'catalog.media.delete',
        entityType: 'product_media',
        entityId: data.id,
      },
    };
  },
});

export const reorderMedia = defineAction({
  permission: 'catalog.write',
  input: MediaReorderSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    // Назначаем sort по индексу в массиве.
    for (let i = 0; i < data.order.length; i++) {
      await sql`
        UPDATE product_media SET sort = ${i}
        WHERE id = ${data.order[i]!} AND product_id = ${data.productId}
      `;
    }
    if (data.primaryId) {
      // Снимаем прежнее главное, ставим новое (уникальный частичный индекс защищает).
      await sql`
        UPDATE product_media SET is_primary = false
        WHERE product_id = ${data.productId} AND is_primary
      `;
      await sql`
        UPDATE product_media SET is_primary = true
        WHERE id = ${data.primaryId} AND product_id = ${data.productId}
      `;
    }
    return {
      result: { productId: data.productId },
      revalidate: [productPath(data.productId)],
      audit: {
        action: 'catalog.media.reorder',
        entityType: 'product',
        entityId: data.productId,
        after: { order: data.order, primaryId: data.primaryId ?? null },
      },
    };
  },
});

// =============================================================================
// ОСТАТКИ (§4.7).
// =============================================================================

export const setInventory = defineAction({
  permission: 'catalog.write',
  input: StockSetSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    // UPSERT по (product, variant, warehouse). COALESCE variant_id для конфликта.
    const rows = await sql<{ id: string; quantity: number }[]>`
      INSERT INTO inventory (product_id, variant_id, warehouse_code, quantity, updated_at)
      VALUES (${data.productId}, ${data.variantId ?? null},
              ${data.warehouseCode ?? 'main'}, ${data.quantity}, now())
      ON CONFLICT (product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), warehouse_code)
      DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()
      RETURNING id, quantity
    `;
    return {
      result: { id: rows[0]!.id, quantity: rows[0]!.quantity },
      revalidate: [productPath(data.productId)],
      audit: {
        action: 'catalog.inventory.set',
        entityType: 'inventory',
        entityId: rows[0]!.id,
        after: {
          productId: data.productId,
          variantId: data.variantId ?? null,
          quantity: data.quantity,
        },
      },
    };
  },
});

export const adjustInventory = defineAction({
  permission: 'catalog.write',
  input: StockAdjustSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    // Атомарная корректировка: итог не уходит ниже 0 (условие в WHERE + CHECK).
    const rows = await sql<{ id: string; quantity: number }[]>`
      INSERT INTO inventory (product_id, variant_id, warehouse_code, quantity, updated_at)
      VALUES (${data.productId}, ${data.variantId ?? null},
              ${data.warehouseCode ?? 'main'}, GREATEST(${data.delta}, 0), now())
      ON CONFLICT (product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), warehouse_code)
      DO UPDATE SET quantity = inventory.quantity + ${data.delta}, updated_at = now()
      WHERE inventory.quantity + ${data.delta} >= 0
      RETURNING id, quantity
    `;
    if (!rows[0]) {
      throw new CatalogError(
        'insufficient_stock',
        'Недостаточно остатка для списания (итог был бы отрицательным).',
      );
    }
    return {
      result: { id: rows[0].id, quantity: rows[0].quantity },
      revalidate: [productPath(data.productId)],
      audit: {
        action: 'catalog.inventory.adjust',
        entityType: 'inventory',
        entityId: rows[0].id,
        after: {
          productId: data.productId,
          variantId: data.variantId ?? null,
          delta: data.delta,
          quantity: rows[0].quantity,
        },
      },
    };
  },
});

// =============================================================================
// БРЕНДЫ (docs/06 §3.3, §4.3).
//
// Бренд — опциональная фасетная сущность (Brembo/Bosch/…); для магазинов без
// брендов таблица пуста. CRUD — тот же пайплайн defineAction (catalog.write,
// аудит catalog.brand.*). Лого бренда — через тот же storage/validate, что и
// медиа товара. Удаление бренда не удаляет товары (ON DELETE SET NULL у brand_id).
// =============================================================================

export const createBrand = defineAction({
  permission: 'catalog.write',
  input: BrandCreateSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const base = data.slug || slugify(data.name);

    const row = await insertWithUniqueSlug(base, async (slug) => {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO brands
          (slug, name, description, is_active, sort, seo_title, seo_description)
        VALUES (
          ${slug}, ${data.name}, ${data.description ?? ''},
          ${data.isActive ?? true}, ${data.sort ?? 0},
          ${data.seoTitle ?? null}, ${data.seoDescription ?? null}
        )
        RETURNING id
      `;
      return rows[0]!;
    });

    return {
      result: { id: row.id },
      revalidate: [BRANDS_PATH, CATALOG_LIST_PATH],
      audit: {
        action: 'catalog.brand.create',
        entityType: 'brand',
        entityId: row.id,
        after: { slug: base, name: data.name },
      },
    };
  },
});

export const updateBrand = defineAction({
  permission: 'catalog.write',
  input: BrandUpdateSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    const before = await sql<Record<string, unknown>[]>`
      SELECT * FROM brands WHERE id = ${data.id} LIMIT 1
    `;
    if (!before[0]) {
      throw new CatalogError('not_found', 'Бренд не найден.');
    }
    const after = await sql<Record<string, unknown>[]>`
      UPDATE brands SET
        slug            = COALESCE(${data.slug ?? null}, slug),
        name            = COALESCE(${data.name ?? null}, name),
        description     = COALESCE(${data.description ?? null}, description),
        is_active       = COALESCE(${data.isActive ?? null}, is_active),
        sort            = COALESCE(${data.sort ?? null}, sort),
        seo_title       = COALESCE(${data.seoTitle ?? null}, seo_title),
        seo_description = COALESCE(${data.seoDescription ?? null}, seo_description),
        og_title        = CASE WHEN ${data.ogTitle !== undefined}
                               THEN ${data.ogTitle ?? null} ELSE og_title END,
        og_description  = CASE WHEN ${data.ogDescription !== undefined}
                               THEN ${data.ogDescription ?? null} ELSE og_description END,
        og_image_key    = CASE WHEN ${data.ogImageKey !== undefined}
                               THEN ${data.ogImageKey ?? null} ELSE og_image_key END,
        canonical_url   = CASE WHEN ${data.canonicalUrl !== undefined}
                               THEN ${data.canonicalUrl ?? null} ELSE canonical_url END,
        noindex         = COALESCE(${data.noindex ?? null}, noindex),
        updated_at      = now()
      WHERE id = ${data.id}
      RETURNING *
    `;
    return {
      result: { id: data.id },
      revalidate: [BRANDS_PATH, brandPath(data.id), SITEMAP_PATH],
      audit: {
        action: 'catalog.brand.update',
        entityType: 'brand',
        entityId: data.id,
        before: before[0],
        after: after[0],
      },
    };
  },
});

export const deleteBrand = defineAction({
  permission: 'catalog.write',
  input: BrandIdSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();
    // ON DELETE SET NULL: товары не удаляются, у них обнуляется brand_id (docs/06 §3.3).
    const rows = await sql<{ id: string; logo_key: string | null }[]>`
      DELETE FROM brands WHERE id = ${data.id}
      RETURNING id, logo_key
    `;
    if (!rows[0]) {
      throw new CatalogError('not_found', 'Бренд не найден.');
    }
    // Чистим лого в хранилище (best-effort), если было.
    if (rows[0].logo_key) {
      await getStorage().delete(rows[0].logo_key).catch(() => {});
    }
    return {
      result: { id: data.id },
      revalidate: [BRANDS_PATH, CATALOG_LIST_PATH],
      audit: {
        action: 'catalog.brand.delete',
        entityType: 'brand',
        entityId: data.id,
      },
    };
  },
});

export const uploadBrandLogo = defineAction({
  permission: 'catalog.write',
  input: BrandLogoUploadSchema,
  handler: async (data, _ctx) => {
    assertCatalogEnabled();

    // Бренд должен существовать (иначе осиротевший объект в хранилище).
    const brand = await sql<{ id: string; logo_key: string | null }[]>`
      SELECT id, logo_key FROM brands WHERE id = ${data.brandId} LIMIT 1
    `;
    if (!brand[0]) {
      throw new CatalogError('not_found', 'Бренд не найден.');
    }

    // Валидация magic-bytes + лимиты (как медиа товара).
    const validation = await validateUpload(data.bytes, data.filename);
    if (!validation.ok || !validation.mime) {
      throw new CatalogError('invalid_media', validation.error ?? 'Недопустимый файл.');
    }

    // Превью/нормализация в webp.
    const previews = await generatePreviews(data.bytes);
    const main = previews.main;

    const storage = getStorage();
    const key = `brands/${data.brandId}/${crypto.randomUUID()}.webp`;
    let put;
    try {
      put = await storage.put(key, main.buffer, 'image/webp');
    } catch {
      throw new CatalogError('storage_failed', 'Не удалось сохранить файл в хранилище.');
    }

    try {
      await sql`
        UPDATE brands SET logo_key = ${put.key}, updated_at = now()
        WHERE id = ${data.brandId}
      `;
    } catch (err) {
      await storage.delete(put.key).catch(() => {});
      throw err;
    }

    // Старое лого удаляем после успешной замены (best-effort).
    const prevKey = brand[0].logo_key;
    if (prevKey && prevKey !== put.key) {
      await storage.delete(prevKey).catch(() => {});
    }

    return {
      result: { id: data.brandId, url: put.url, key: put.key },
      revalidate: [BRANDS_PATH, brandPath(data.brandId)],
      audit: {
        action: 'catalog.brand.logo.upload',
        entityType: 'brand',
        entityId: data.brandId,
        after: { key: put.key },
      },
    };
  },
});
