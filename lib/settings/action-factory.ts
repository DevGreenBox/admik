/**
 * Фабрика Server Actions настроек магазина (docs/11 §5.4.3, ADR-013).
 *
 * Вынесена из lib/settings/actions.ts ('use server'), т.к. такой модуль может
 * экспортировать ТОЛЬКО async-функции, а здесь живут: фабрика createSettingsActions
 * (синхронная, возвращает объект действий), входные Zod-схемы, типы зависимостей и
 * дефолтные data-чекеры. actions.ts тонко оборачивает прод-экземпляр.
 *
 * Все мутации — через единый пайплайн defineAction({permission:'settings.manage'}):
 * guard → Zod → handler (upsert/delete shop_settings) → revalidate → audit.
 * После КАЖДОЙ мутации вызывается invalidateCache() (read-your-own-writes).
 *
 * Деньги: freeDeliveryThreshold вводится в РУБЛЯХ (money-строка) → хранится в
 * КОПЕЙКАХ (int) через toMinor — новый JSONB-слой delivery.value (копейки).
 *
 * ТЕСТИРУЕМОСТЬ без БД/Next (ADR-004): createSettingsActions(deps) инъецирует
 * репозиторий/инвалидацию кеша/data-чекеры и ActionDeps.
 */

import { z } from 'zod';

import {
  defineAction,
  defaultDeps,
  type ActionDeps,
  type ActionCtx,
} from '@/lib/server/action';
import { sql } from '@/lib/db/client';
import { toMinor } from '@/lib/orders/money';
import {
  brandingSchema,
  currencySchema,
  unitsSchema,
  contactsSchema,
  legalEntitySchema,
  catalogSettingsSchema,
  ordersSettingsSchema,
  seoSettingsSchema,
  SETTING_KEYS,
} from '@/lib/settings/schemas';
import {
  upsertSetting as dbUpsertSetting,
  deleteSetting as dbDeleteSetting,
  getSetting as dbGetSetting,
  type ShopSettingRow,
} from '@/lib/settings/repository';
import { invalidateSettingsCache } from '@/lib/config/settings';

// =============================================================================
// Входные схемы действий (композиция value-схем ключей).
// =============================================================================

/** Денежная величина в РУБЛЯХ (money-строка/число) — для ввода порога доставки. */
const moneyRubles = z
  .union([z.string(), z.number()])
  .refine((v) => {
    try {
      toMinor(v as string | number);
      return true;
    } catch {
      return false;
    }
  }, 'Ожидается неотрицательная сумма в рублях (до 2 знаков после точки)');

/** delivery на ВХОДЕ: порог в рублях (конвертируется в копейки в handler). */
const deliveryInputSchema = z
  .object({ freeDeliveryThreshold: moneyRubles.optional() })
  .strip();

export const BrandingInputSchema = z.object({ branding: brandingSchema });
export const CurrencyUnitsInputSchema = z.object({
  currency: currencySchema.optional(),
  units: unitsSchema.optional(),
});
export const LegalContactsInputSchema = z.object({
  legalEntity: legalEntitySchema.optional(),
  contacts: contactsSchema.optional(),
});
export const CatalogOrdersInputSchema = z.object({
  catalog: catalogSettingsSchema.optional(),
  delivery: deliveryInputSchema.optional(),
  orders: ordersSettingsSchema.optional(),
});
/**
 * module_overrides на ВХОДЕ действия — `.strict()`: неизвестный модуль (опечатка
 * или попытка переключить core, напр. `settings`) → validation-ошибка, а не тихий
 * `.strip()`. Merge-слой (lib/config/settings) использует мягкий `.strip()` для
 * толерантности к строкам БД; UI-ввод обязан быть точным.
 */
export const ModuleOverridesInputSchema = z.object({
  moduleOverrides: z
    .object({
      catalog: z.boolean().optional(),
      orders: z.boolean().optional(),
      cdek: z.boolean().optional(),
      cms: z.boolean().optional(),
    })
    .strict(),
});
/** reset: ключ обязан быть известным разделом настроек (иначе validation). */
export const ResetSettingInputSchema = z.object({
  key: z.enum(SETTING_KEYS),
});

/**
 * seo на ВХОДЕ действия (docs/11 §5.3.3): базовая seoSettingsSchema +
 * дополнительная проверка `title_template` обязан содержать '%s' (плейсхолдер
 * заголовка). Без '%s' заголовки сущностей подставлять некуда → validation.
 * site_url валидируется как url-или-отсутствует уже в seoSettingsSchema.
 */
export const SeoSettingsInputSchema = z.object({
  seo: seoSettingsSchema.superRefine((value, ctx) => {
    if (value.title_template !== undefined && !value.title_template.includes('%s')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "title_template должен содержать плейсхолдер «%s»",
        path: ['title_template'],
      });
    }
  }),
});

// =============================================================================
// Зависимости фабрики (инъекция для тестов без БД).
// =============================================================================

/** Результат updateModuleOverrides: warnings — мягкие предупреждения (не блок). */
export interface ModuleOverridesResult {
  warnings: string[];
}

/** Зависимости settings-actions. */
export interface SettingsActionDeps {
  /** Зависимости пайплайна defineAction (user/audit/revalidate/meta). */
  actionDeps: ActionDeps;
  /** UPSERT строки настроек. */
  upsertSetting: (
    key: string,
    value: Record<string, unknown>,
    updatedBy: string | null,
  ) => Promise<ShopSettingRow>;
  /** DELETE строки настроек (reset к env-дефолту). */
  deleteSetting: (key: string) => Promise<boolean>;
  /** Чтение строки (before-снимок для audit). */
  getSetting: (key: string) => Promise<ShopSettingRow | null>;
  /** Сброс memo эффективных настроек (read-your-own-writes). */
  invalidateCache: () => void;
  /** Есть ли опубликованные CMS-страницы (для warning при выключении cms). */
  hasPublishedCmsPages: () => Promise<boolean>;
}

/** Пути инвалидации витрины (форматирование цен/брендинг). */
const STOREFRONT_PATHS = ['/'] as const;
/** Путь раздела настроек админки. */
const SETTINGS_PATH = '/admin/settings';

/**
 * Дефолтный data-чекер: есть ли опубликованные CMS-страницы. Защитно толерантен
 * к отсутствию таблицы cms_pages (пакет 5.C-1 может быть ещё не накатан) —
 * to_regclass вернёт NULL → подзапрос count не выполняется, возвращаем false.
 */
export async function defaultHasPublishedCmsPages(): Promise<boolean> {
  try {
    const rows = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM cms_pages WHERE status = 'published'
      ) AS exists
      WHERE to_regclass('public.cms_pages') IS NOT NULL
    `;
    return rows[0]?.exists ?? false;
  } catch {
    // Таблица отсутствует/иная ошибка чтения → считаем, что данных нет.
    return false;
  }
}

/** Прод-зависимости (реальная БД + дефолтный пайплайн). */
export function productionSettingsDeps(): SettingsActionDeps {
  return {
    actionDeps: defaultDeps,
    upsertSetting: dbUpsertSetting,
    deleteSetting: dbDeleteSetting,
    getSetting: dbGetSetting,
    invalidateCache: invalidateSettingsCache,
    hasPublishedCmsPages: defaultHasPublishedCmsPages,
  };
}

// =============================================================================
// Фабрика действий.
// =============================================================================

/**
 * Собирает набор settings-actions поверх инъецированных зависимостей.
 * Прод-обёртки (lib/settings/actions.ts) вызывают её с productionSettingsDeps().
 */
export function createSettingsActions(deps: SettingsActionDeps) {
  const { actionDeps } = deps;

  const updateBrandingSettings = defineAction({
    permission: 'settings.manage',
    input: BrandingInputSchema,
    deps: actionDeps,
    handler: async (data, ctx: ActionCtx) => {
      const before = await deps.getSetting('branding');
      const row = await deps.upsertSetting('branding', data.branding, ctx.user.id);
      deps.invalidateCache();
      return {
        result: { key: 'branding' as const },
        revalidate: ['/admin', SETTINGS_PATH, ...STOREFRONT_PATHS],
        audit: {
          action: 'settings.branding.update',
          entityType: 'shop_settings',
          entityId: 'branding',
          before: before?.value,
          after: row.value,
        },
      };
    },
  });

  const updateCurrencyAndUnits = defineAction({
    permission: 'settings.manage',
    input: CurrencyUnitsInputSchema,
    deps: actionDeps,
    handler: async (data, ctx: ActionCtx) => {
      const before = {
        currency: (await deps.getSetting('currency'))?.value,
        units: (await deps.getSetting('units'))?.value,
      };
      if (data.currency) await deps.upsertSetting('currency', data.currency, ctx.user.id);
      if (data.units) await deps.upsertSetting('units', data.units, ctx.user.id);
      deps.invalidateCache();
      return {
        result: { keys: ['currency', 'units'] as const },
        // Форматирование цен зависит от валюты → инвалидируем витрину.
        revalidate: ['/admin', SETTINGS_PATH, ...STOREFRONT_PATHS],
        audit: {
          action: 'settings.currency_units.update',
          entityType: 'shop_settings',
          entityId: 'currency,units',
          before,
          after: { currency: data.currency, units: data.units },
        },
      };
    },
  });

  const updateLegalAndContacts = defineAction({
    permission: 'settings.manage',
    input: LegalContactsInputSchema,
    deps: actionDeps,
    handler: async (data, ctx: ActionCtx) => {
      const before = {
        legal_entity: (await deps.getSetting('legal_entity'))?.value,
        contacts: (await deps.getSetting('contacts'))?.value,
      };
      if (data.legalEntity)
        await deps.upsertSetting('legal_entity', data.legalEntity, ctx.user.id);
      if (data.contacts) await deps.upsertSetting('contacts', data.contacts, ctx.user.id);
      deps.invalidateCache();
      return {
        result: { keys: ['legal_entity', 'contacts'] as const },
        revalidate: ['/admin', SETTINGS_PATH, ...STOREFRONT_PATHS],
        audit: {
          action: 'settings.legal_contacts.update',
          entityType: 'shop_settings',
          entityId: 'legal_entity,contacts',
          before,
          after: { legal_entity: data.legalEntity, contacts: data.contacts },
        },
      };
    },
  });

  const updateCatalogOrdersSettings = defineAction({
    permission: 'settings.manage',
    input: CatalogOrdersInputSchema,
    deps: actionDeps,
    handler: async (data, ctx: ActionCtx) => {
      const before = {
        catalog: (await deps.getSetting('catalog'))?.value,
        delivery: (await deps.getSetting('delivery'))?.value,
        orders: (await deps.getSetting('orders'))?.value,
      };
      if (data.catalog) await deps.upsertSetting('catalog', data.catalog, ctx.user.id);
      // freeDeliveryThreshold: рубли (ввод) → копейки (хранение).
      let deliveryValue: { freeDeliveryThreshold?: number } | undefined;
      if (data.delivery && data.delivery.freeDeliveryThreshold !== undefined) {
        deliveryValue = { freeDeliveryThreshold: toMinor(data.delivery.freeDeliveryThreshold) };
        await deps.upsertSetting('delivery', deliveryValue, ctx.user.id);
      }
      if (data.orders) await deps.upsertSetting('orders', data.orders, ctx.user.id);
      deps.invalidateCache();
      return {
        result: { keys: ['catalog', 'delivery', 'orders'] as const },
        revalidate: ['/admin', SETTINGS_PATH, ...STOREFRONT_PATHS],
        audit: {
          action: 'settings.catalog_orders.update',
          entityType: 'shop_settings',
          entityId: 'catalog,delivery,orders',
          before,
          after: { catalog: data.catalog, delivery: deliveryValue, orders: data.orders },
        },
      };
    },
  });

  const updateModuleOverrides = defineAction<
    z.infer<typeof ModuleOverridesInputSchema>,
    ModuleOverridesResult
  >({
    permission: 'settings.manage',
    input: ModuleOverridesInputSchema,
    deps: actionDeps,
    handler: async (data, ctx: ActionCtx) => {
      const before = await deps.getSetting('module_overrides');
      // self-lock невозможен на уровне схемы: 'settings' не входит в
      // moduleOverridesSchema (.strip() отбросит любой неизвестный ключ ещё на
      // этапе валидации). /admin/settings — core-пункт (без module) → не исчезает.
      const row = await deps.upsertSetting(
        'module_overrides',
        data.moduleOverrides,
        ctx.user.id,
      );

      // Мягкие предупреждения: выключение модуля с активными данными НЕ блокирует
      // (данные не удаляются, лишь скрывается UI/API).
      const warnings: string[] = [];
      if (data.moduleOverrides.cms === false && (await deps.hasPublishedCmsPages())) {
        warnings.push('cms_has_published_pages');
      }

      deps.invalidateCache();
      return {
        result: { warnings },
        // Меняется состав меню/доступность роутов → инвалидируем весь /admin и витрину.
        revalidate: ['/admin', SETTINGS_PATH, ...STOREFRONT_PATHS],
        audit: {
          action: 'settings.modules.update',
          entityType: 'shop_settings',
          entityId: 'module_overrides',
          before: before?.value,
          after: row.value,
        },
      };
    },
  });

  const updateShopSeoSettings = defineAction({
    permission: 'settings.manage',
    input: SeoSettingsInputSchema,
    deps: actionDeps,
    handler: async (data, ctx: ActionCtx) => {
      const before = await deps.getSetting('seo');
      const row = await deps.upsertSetting('seo', data.seo, ctx.user.id);
      deps.invalidateCache();
      return {
        result: { key: 'seo' as const },
        // SEO влияет на sitemap/robots/форму настроек SEO → инвалидируем их.
        revalidate: ['/sitemap.xml', '/robots.txt', '/admin/settings/seo'],
        audit: {
          action: 'settings.seo.update',
          entityType: 'shop_settings',
          entityId: 'seo',
          before: before?.value,
          after: row.value,
        },
      };
    },
  });

  const resetSetting = defineAction({
    permission: 'settings.manage',
    input: ResetSettingInputSchema,
    deps: actionDeps,
    handler: async (data, _ctx: ActionCtx) => {
      // Ключ уже провалидирован Zod-enum (известный раздел настроек).
      const before = await deps.getSetting(data.key);
      const deleted = await deps.deleteSetting(data.key);
      deps.invalidateCache();
      return {
        result: { key: data.key, deleted },
        revalidate: ['/admin', SETTINGS_PATH, ...STOREFRONT_PATHS],
        audit: {
          action: 'settings.reset',
          entityType: 'shop_settings',
          entityId: data.key,
          before: before?.value,
        },
      };
    },
  });

  return {
    updateBrandingSettings,
    updateCurrencyAndUnits,
    updateLegalAndContacts,
    updateCatalogOrdersSettings,
    updateModuleOverrides,
    updateShopSeoSettings,
    resetSetting,
  };
}
