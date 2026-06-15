/**
 * Публичный DTO настроек магазина для Storefront API (docs/11 §5.4.4, ADR-008).
 *
 * ПРИНЦИП DTO-изоляции (§7): витрине отдаём ТОЛЬКО публично-безопасные поля.
 * СКРЫВАЕМ:
 *   - audit-trail строки (`updated_by`/`updated_at`) — внутренняя информация;
 *   - `legalEntity.bankDetails` — приватные банковские реквизиты;
 *   - оверрайд модулей (`module_overrides`) — внутренняя конфигурация;
 *   - приватные SEO-ключи (`default_og_image_key` — ключ S3, не URL).
 *
 * ОТДАЁМ: брендинг (без приватных полей), валюту, единицы, публичные контакты,
 * публичные реквизиты юрлица (без банковских), порог бесплатной доставки (копейки),
 * публичные SEO-дефолты (site_name/site_url/title_template/...). Деньги — в КОПЕЙКАХ.
 *
 * Чистая функция — тестируется без БД/Next. Источник — `EffectiveSettings`
 * (env ⊕ БД), сам по себе уже без audit-полей; DTO дополнительно вырезает
 * приватные части (bankDetails, og_image_key).
 */

import type { EffectiveSettings } from '@/lib/config/settings';

/** Публичная социальная ссылка. */
export interface PublicSocialDto {
  type: string;
  url: string;
}

/** Публичный DTO настроек магазина (наружу витрине). */
export interface PublicSettingsDto {
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
  contacts: {
    phone: string | null;
    email: string | null;
    address: string | null;
    workingHours: string | null;
    socials: PublicSocialDto[];
  };
  /** Публичные реквизиты юрлица — БЕЗ bankDetails. */
  legalEntity: {
    name: string | null;
    inn: string | null;
    kpp: string | null;
    ogrn: string | null;
    legalAddress: string | null;
  };
  delivery: {
    /** Порог бесплатной доставки — в КОПЕЙКАХ (0 = выключено). */
    freeDeliveryThreshold: number;
  };
  seo: {
    siteName: string | null;
    siteUrl: string | null;
    titleTemplate: string;
    defaultDescription: string | null;
    twitterSite: string | null;
  };
}

/**
 * Преобразует эффективные настройки в публичный DTO витрины.
 * Вырезает приватные поля (bankDetails, og_image_key, robots_extra,
 * noindex_site, module_overrides) и audit-trail. Деньги остаются в копейках.
 */
export function toPublicSettingsDto(eff: EffectiveSettings): PublicSettingsDto {
  return {
    branding: {
      shopName: eff.branding.shopName,
      logoUrl: eff.branding.logoUrl,
      faviconUrl: eff.branding.faviconUrl,
      theme: {
        primaryColor: eff.branding.theme.primaryColor,
        accentColor: eff.branding.theme.accentColor,
        mode: eff.branding.theme.mode,
      },
      supportEmail: eff.branding.supportEmail,
      supportPhone: eff.branding.supportPhone,
    },
    currency: {
      code: eff.currency.code,
      symbol: eff.currency.symbol,
      locale: eff.currency.locale,
      fractionDigits: eff.currency.fractionDigits,
    },
    units: {
      weight: eff.units.weight,
      dimension: eff.units.dimension,
      system: eff.units.system,
    },
    contacts: {
      phone: eff.contacts.phone ?? null,
      email: eff.contacts.email ?? null,
      address: eff.contacts.address ?? null,
      workingHours: eff.contacts.workingHours ?? null,
      socials: (eff.contacts.socials ?? []).map((s) => ({ type: s.type, url: s.url })),
    },
    legalEntity: {
      name: eff.legalEntity.name ?? null,
      inn: eff.legalEntity.inn ?? null,
      kpp: eff.legalEntity.kpp ?? null,
      ogrn: eff.legalEntity.ogrn ?? null,
      legalAddress: eff.legalEntity.legalAddress ?? null,
      // bankDetails намеренно НЕ включён — приватные реквизиты.
    },
    delivery: {
      freeDeliveryThreshold: eff.delivery.freeDeliveryThreshold,
    },
    seo: {
      siteName: eff.seo.site_name ?? null,
      siteUrl: eff.seo.site_url ?? null,
      titleTemplate: eff.seo.title_template,
      defaultDescription: eff.seo.default_description ?? null,
      twitterSite: eff.seo.twitter_site ?? null,
      // default_og_image_key (ключ S3), robots_extra, noindex_site — НЕ наружу.
    },
  };
}
