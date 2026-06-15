/**
 * Zod-схемы входа для Server Actions каталога (docs/05 §4).
 *
 * Экспортируются для переиспользования в UI (формы админки): один источник
 * правды о форме входных данных. Все мутации каталога валидируются этими
 * схемами внутри defineAction (§4.7).
 *
 * Правила контракта (docs/05 §2):
 *  - slug — строгий ЧПУ ([a-z0-9-], без двойных/краевых дефисов);
 *  - деньги — строка NUMERIC ≥ 0 (точность не теряем, валидируем формат);
 *  - id — uuid; status/type — литералы из CHECK-ограничений БД.
 */

import { z } from 'zod';

import {
  ATTRIBUTE_TYPES,
  MEDIA_TYPES,
  PRODUCT_STATUSES,
} from './types';

// -----------------------------------------------------------------------------
// Переиспользуемые примитивы.
// -----------------------------------------------------------------------------

/** UUID-идентификатор. */
export const uuidSchema = z.string().uuid();

/**
 * Строгий slug: только [a-z0-9] с одиночными дефисами между сегментами.
 * Совпадает с выходом slugify / isValidSlug.
 */
export const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'slug: только латиница в нижнем регистре, цифры и дефисы (без двойных/краевых дефисов)',
  );

/** Артикул (sku): непустой, регистронезависим в БД (citext); до 100 символов. */
export const skuSchema = z.string().trim().min(1).max(100);

/**
 * Денежная сумма NUMERIC(14,2) ≥ 0 как строка.
 * Принимает целое/дробное (до 2 знаков), без минуса. Длина целой части ≤ 12.
 */
export const moneySchema = z
  .string()
  .trim()
  .regex(
    /^\d{1,12}(?:\.\d{1,2})?$/,
    'цена: неотрицательное число с не более чем 2 знаками после точки',
  );

/** Код характеристики (attributes.code): стабильный идентификатор. */
export const attributeCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9_]+$/,
    'код атрибута: латиница в нижнем регистре, цифры и подчёркивание',
  );

const seoTitle = z.string().max(255).optional();
const seoDescription = z.string().max(1000).optional();

// -----------------------------------------------------------------------------
// Категории (§4.3).
// -----------------------------------------------------------------------------

export const CategoryCreateSchema = z.object({
  parentId: uuidSchema.nullish(),
  slug: slugSchema,
  name: z.string().trim().min(1).max(255),
  description: z.string().max(5000).optional().default(''),
  sort: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
  seoTitle,
  seoDescription,
});
export type CategoryCreateInput = z.infer<typeof CategoryCreateSchema>;

export const CategoryUpdateSchema = CategoryCreateSchema.partial().extend({
  id: uuidSchema,
});
export type CategoryUpdateInput = z.infer<typeof CategoryUpdateSchema>;

export const CategoryMoveSchema = z.object({
  id: uuidSchema,
  /** Новый родитель; null → перенести в корень. */
  parentId: uuidSchema.nullable(),
  sort: z.number().int().min(0).optional(),
});
export type CategoryMoveInput = z.infer<typeof CategoryMoveSchema>;

export const CategoryDeleteSchema = z.object({ id: uuidSchema });

// -----------------------------------------------------------------------------
// Товары (§4.2).
// -----------------------------------------------------------------------------

export const ProductCreateSchema = z
  .object({
    sku: skuSchema,
    slug: slugSchema,
    name: z.string().trim().min(1).max(255),
    description: z.string().max(50000).optional().default(''),
    status: z.enum(PRODUCT_STATUSES).optional().default('draft'),
    basePrice: moneySchema.optional().default('0'),
    categoryIds: z.array(uuidSchema).optional().default([]),
    primaryCategoryId: uuidSchema.nullish(),
    seoTitle,
    seoDescription,
  })
  .refine(
    (v) =>
      !v.primaryCategoryId ||
      (v.categoryIds?.includes(v.primaryCategoryId) ?? false),
    {
      message: 'primaryCategoryId должна входить в categoryIds',
      path: ['primaryCategoryId'],
    },
  );
export type ProductCreateInput = z.infer<typeof ProductCreateSchema>;

export const ProductUpdateSchema = z.object({
  id: uuidSchema,
  sku: skuSchema.optional(),
  slug: slugSchema.optional(),
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(50000).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  basePrice: moneySchema.optional(),
  categoryIds: z.array(uuidSchema).optional(),
  primaryCategoryId: uuidSchema.nullish(),
  seoTitle,
  seoDescription,
});
export type ProductUpdateInput = z.infer<typeof ProductUpdateSchema>;

export const ProductIdSchema = z.object({ id: uuidSchema });

// -----------------------------------------------------------------------------
// Варианты (§4.4).
// -----------------------------------------------------------------------------

export const VariantCreateSchema = z.object({
  productId: uuidSchema,
  sku: skuSchema,
  name: z.string().trim().max(255).optional().default(''),
  priceOverride: moneySchema.nullish(),
  priceDelta: moneySchema.optional().default('0'),
  isActive: z.boolean().optional().default(true),
  sort: z.number().int().min(0).optional().default(0),
});
export type VariantCreateInput = z.infer<typeof VariantCreateSchema>;

export const VariantUpdateSchema = z.object({
  id: uuidSchema,
  sku: skuSchema.optional(),
  name: z.string().trim().max(255).optional(),
  priceOverride: moneySchema.nullish(),
  priceDelta: moneySchema.optional(),
  isActive: z.boolean().optional(),
  sort: z.number().int().min(0).optional(),
});
export type VariantUpdateInput = z.infer<typeof VariantUpdateSchema>;

export const VariantIdSchema = z.object({ id: uuidSchema });

// -----------------------------------------------------------------------------
// Характеристики (§4.5).
// -----------------------------------------------------------------------------

export const AttributeCreateSchema = z.object({
  code: attributeCodeSchema,
  name: z.string().trim().min(1).max(255),
  type: z.enum(ATTRIBUTE_TYPES).optional().default('select'),
  unit: z.string().trim().max(32).nullish(),
  isVariant: z.boolean().optional().default(false),
  isFilterable: z.boolean().optional().default(true),
  isRequired: z.boolean().optional().default(false),
  sort: z.number().int().min(0).optional().default(0),
});
export type AttributeCreateInput = z.infer<typeof AttributeCreateSchema>;

export const AttributeUpdateSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1).max(255).optional(),
  type: z.enum(ATTRIBUTE_TYPES).optional(),
  unit: z.string().trim().max(32).nullish(),
  isVariant: z.boolean().optional(),
  isFilterable: z.boolean().optional(),
  isRequired: z.boolean().optional(),
  sort: z.number().int().min(0).optional(),
});
export type AttributeUpdateInput = z.infer<typeof AttributeUpdateSchema>;

export const AttributeValueSchema = z.object({
  attributeId: uuidSchema,
  value: z.string().trim().min(1).max(255),
  slug: slugSchema.nullish(),
  sort: z.number().int().min(0).optional().default(0),
});
export type AttributeValueInput = z.infer<typeof AttributeValueSchema>;

/** Одна привязка значения характеристики к товару/варианту. */
export const ProductAttributeItemSchema = z
  .object({
    attributeId: uuidSchema,
    variantId: uuidSchema.nullish(),
    /** Ссылка на словарь (для select). */
    valueId: uuidSchema.nullish(),
    /** Инлайн-значение (text/number/boolean). */
    valueText: z.string().max(1000).nullish(),
  })
  .refine((v) => Boolean(v.valueId) || Boolean(v.valueText), {
    message: 'нужно указать valueId (select) или valueText (text/number/boolean)',
    path: ['valueId'],
  });

export const SetProductAttributesSchema = z.object({
  productId: uuidSchema,
  items: z.array(ProductAttributeItemSchema),
});
export type SetProductAttributesInput = z.infer<
  typeof SetProductAttributesSchema
>;

// -----------------------------------------------------------------------------
// Медиа (§4.6).
// -----------------------------------------------------------------------------

/**
 * Вход загрузки медиа. Байты передаются как Buffer (Server Action принимает из
 * FormData/route). Тип/размер реально проверяются validateUpload по magic-bytes.
 */
export const MediaUploadSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.nullish(),
  /** Имя файла — только для диагностики, в ключ объекта НЕ попадает. */
  filename: z.string().max(255).optional().default('upload'),
  bytes: z.instanceof(Buffer),
  type: z.enum(MEDIA_TYPES).optional().default('image'),
  alt: z.string().max(255).optional().default(''),
  isPrimary: z.boolean().optional().default(false),
});
export type MediaUploadInput = z.infer<typeof MediaUploadSchema>;

export const MediaDeleteSchema = z.object({ id: uuidSchema });

export const MediaReorderSchema = z.object({
  productId: uuidSchema,
  /** Порядок id медиа; индекс в массиве → значение sort. */
  order: z.array(uuidSchema),
  /** Опционально назначить главное изображение. */
  primaryId: uuidSchema.nullish(),
});
export type MediaReorderInput = z.infer<typeof MediaReorderSchema>;

// -----------------------------------------------------------------------------
// Остатки (§4.7).
// -----------------------------------------------------------------------------

export const StockSetSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.nullish(),
  warehouseCode: z.string().trim().min(1).max(64).optional().default('main'),
  /** Абсолютное значение остатка (≥0). */
  quantity: z.number().int().min(0),
});
export type StockSetInput = z.infer<typeof StockSetSchema>;

export const StockAdjustSchema = z
  .object({
    productId: uuidSchema,
    variantId: uuidSchema.nullish(),
    warehouseCode: z.string().trim().min(1).max(64).optional().default('main'),
    /** Дельта изменения (может быть отрицательной); итог не уходит ниже 0. */
    delta: z.number().int(),
  })
  .refine((v) => v.delta !== 0, {
    message: 'delta не может быть 0',
    path: ['delta'],
  });
export type StockAdjustInput = z.infer<typeof StockAdjustSchema>;
