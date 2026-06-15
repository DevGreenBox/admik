/**
 * Слой ЭФФЕКТИВНЫХ настроек магазина (docs/11 §5.4, ADR-013).
 *
 * Превращает стек из env-driven в DB-driven: env = дефолт, строка БД = частичный
 * оверрайд на уровне полей. Пустой объект `{}` в БД = «нет оверрайда» → env.
 *
 * Состав:
 *   - mergeSettings(env, dbRows)  — ЧИСТАЯ функция (env ⊕ БД), тестируется без БД.
 *   - getEffectiveSettings()      — читает БД ОДИН раз и мемоизирует (module-level).
 *   - invalidateSettingsCache()   — сбрасывает memo (read-your-own-writes из actions).
 *   - getEffectiveModules(env, o) — поверх getEnabledModules накладывает module_overrides.
 *
 * Деньги в эффективных настройках — в КОПЕЙКАХ (int). Конвертация в рубли — только
 * на границе записи в legacy numeric(14,2)-поля (репозиторий заказов), не здесь.
 */

import { getEnv, type Env } from '@/lib/config/env';
import {
  getEnabledModules,
  ALL_MODULES,
  type ModuleName,
} from '@/lib/config/modules';
import {
  parseSettingValue,
  type ModuleOverrides,
  type BrandingSettings,
  type CurrencySettings,
  type UnitsSettings,
  type ContactsSettings,
  type LegalEntitySettings,
  type SeoSettings,
} from '@/lib/settings/schemas';
import { toMinor } from '@/lib/orders/money';
import { getAllSettings, type SettingRow } from '@/lib/settings/repository';

// -----------------------------------------------------------------------------
// Контракт эффективных настроек.
// -----------------------------------------------------------------------------

/** Эффективные настройки магазина (env ⊕ БД). Деньги — в копейках. */
export interface EffectiveSettings {
  branding: {
    shopName: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    theme: {
      primaryColor: string | null;
      accentColor: string | null;
      mode: 'light' | 'dark' | 'system';
    };
    supportEmail: string | null;
    supportPhone: string | null;
  };
  currency: {
    code: string;
    symbol: string | null;
    locale: string | null;
    fractionDigits: number;
  };
  units: {
    weight: 'g' | 'kg';
    dimension: 'cm' | 'mm';
    system: 'metric';
  };
  contacts: ContactsSettings;
  legalEntity: LegalEntitySettings;
  catalog: {
    /** Порог «новизны» товара в днях. */
    newProductDays: number;
  };
  delivery: {
    /** Порог бесплатной доставки — в КОПЕЙКАХ (0 = выключено). */
    freeDeliveryThreshold: number;
  };
  orders: {
    orderPrefix: string;
  };
  seo: SeoSettings & {
    /** Гарантированно непустой шаблон заголовка. */
    title_template: string;
    noindex_site: boolean;
  };
}

// -----------------------------------------------------------------------------
// mergeSettings — ЧИСТАЯ функция env ⊕ БД.
// -----------------------------------------------------------------------------

/** Индексирует строки БД по ключу с безопасным парсом значения. */
function indexRows(dbRows: SettingRow[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of dbRows) {
    if (!map.has(row.setting_key)) {
      map.set(row.setting_key, row.value ?? {});
    }
  }
  return map;
}

/**
 * Сливает env-дефолты со строками БД. Частичный merge на уровне полей: каждое
 * поле берётся из БД, если задано и валидно, иначе из env. Невалидная/пустая
 * строка БД для ключа эквивалентна её отсутствию (раздел падает на env).
 */
export function mergeSettings(env: Env, dbRows: SettingRow[]): EffectiveSettings {
  const rows = indexRows(dbRows);

  const branding: BrandingSettings = parseSettingValue('branding', rows.get('branding')) ?? {};
  const currency: CurrencySettings = parseSettingValue('currency', rows.get('currency')) ?? {};
  const units: UnitsSettings = parseSettingValue('units', rows.get('units')) ?? {};
  const contacts: ContactsSettings = parseSettingValue('contacts', rows.get('contacts')) ?? {};
  const legalEntity: LegalEntitySettings =
    parseSettingValue('legal_entity', rows.get('legal_entity')) ?? {};
  const catalog = parseSettingValue('catalog', rows.get('catalog')) ?? {};
  const delivery = parseSettingValue('delivery', rows.get('delivery')) ?? {};
  const orders = parseSettingValue('orders', rows.get('orders')) ?? {};
  const seo: SeoSettings = parseSettingValue('seo', rows.get('seo')) ?? {};

  return {
    branding: {
      shopName: branding.shopName ?? env.SHOP_NAME ?? 'Admik',
      logoUrl: branding.logoUrl ?? env.SHOP_LOGO_URL ?? null,
      faviconUrl: branding.faviconUrl ?? null,
      theme: {
        primaryColor: branding.theme?.primaryColor ?? null,
        accentColor: branding.theme?.accentColor ?? null,
        mode: branding.theme?.mode ?? 'system',
      },
      supportEmail: branding.supportEmail ?? null,
      supportPhone: branding.supportPhone ?? null,
    },
    currency: {
      code: currency.code ?? env.SHOP_CURRENCY,
      symbol: currency.symbol ?? null,
      locale: currency.locale ?? null,
      fractionDigits: currency.fractionDigits ?? 2,
    },
    units: {
      weight: units.weight ?? 'g',
      dimension: units.dimension ?? 'cm',
      system: 'metric',
    },
    contacts,
    legalEntity,
    catalog: {
      newProductDays: catalog.newProductDays ?? env.SHOP_NEW_PRODUCT_DAYS,
    },
    delivery: {
      // env-порог задаётся в рублях (number) → конвертируем в копейки.
      // БД-значение уже в копейках (int) → берём как есть.
      freeDeliveryThreshold:
        delivery.freeDeliveryThreshold ?? toMinor(env.SHOP_FREE_DELIVERY_THRESHOLD),
    },
    orders: {
      orderPrefix: orders.orderPrefix ?? env.SHOP_ORDER_PREFIX,
    },
    seo: {
      site_name: seo.site_name ?? branding.shopName ?? env.SHOP_NAME ?? undefined,
      site_url: seo.site_url ?? undefined,
      title_template: seo.title_template ?? '%s',
      default_description: seo.default_description ?? undefined,
      default_og_image_key: seo.default_og_image_key ?? undefined,
      robots_extra: seo.robots_extra ?? undefined,
      twitter_site: seo.twitter_site ?? undefined,
      noindex_site: seo.noindex_site ?? false,
    },
  };
}

// -----------------------------------------------------------------------------
// getEffectiveModules — env ⊕ module_overrides.
// -----------------------------------------------------------------------------

/**
 * Эффективный набор модулей: базовый env-набор (getEnabledModules) с наложенным
 * частичным module_overrides. Отсутствие ключа в оверрайде → берётся env;
 * `true` включает модуль, `false` выключает. Результат — подмножество
 * ALL_MODULES без дублей.
 */
export function getEffectiveModules(
  env: Record<string, string | undefined> = process.env,
  dbOverrides: ModuleOverrides = {},
): ModuleName[] {
  const base = new Set<ModuleName>(getEnabledModules(env));
  for (const mod of ALL_MODULES) {
    const override = dbOverrides[mod];
    if (override === true) {
      base.add(mod);
    } else if (override === false) {
      base.delete(mod);
    }
  }
  // Детерминированный порядок — по ALL_MODULES.
  return ALL_MODULES.filter((m) => base.has(m));
}

// -----------------------------------------------------------------------------
// getEffectiveSettings — чтение БД с module-level мемоизацией.
// -----------------------------------------------------------------------------

/** Зависимости getEffectiveSettings (инъекция для тестов без БД). */
export interface EffectiveSettingsDeps {
  /** Читатель строк настроек из БД (по умолчанию — репозиторий getAllSettings). */
  readRows?: () => Promise<SettingRow[]>;
  /** Источник env (по умолчанию — getEnv()). */
  env?: Env;
}

/** Module-level memo эффективных настроек (1 чтение БД на процесс до инвалидации). */
let cached: EffectiveSettings | undefined;
/** In-flight промис, чтобы конкурентные вызовы дали ОДНО чтение БД. */
let inflight: Promise<EffectiveSettings> | undefined;

/**
 * Возвращает эффективные настройки. Читает БД ОДИН раз и мемоизирует (module-level).
 * `invalidateSettingsCache()` вызывается из каждого settings-action для
 * read-your-own-writes. Redis-кеш — задел на будущее (1 магазин = 1 БД).
 */
export async function getEffectiveSettings(
  deps: EffectiveSettingsDeps = {},
): Promise<EffectiveSettings> {
  if (cached) return cached;
  if (inflight) return inflight;

  const read = deps.readRows ?? getAllSettings;
  const env = deps.env ?? getEnv();

  inflight = (async () => {
    const rows = await read();
    const merged = mergeSettings(env, rows);
    cached = merged;
    return merged;
  })();

  try {
    return await inflight;
  } finally {
    inflight = undefined;
  }
}

/**
 * Сбрасывает memo эффективных настроек. Вызывается в каждом settings-action
 * после успешной мутации (read-your-own-writes) и в тестах.
 */
export function invalidateSettingsCache(): void {
  cached = undefined;
  inflight = undefined;
}
