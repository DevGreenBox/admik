import { describe, it, expect } from 'vitest';
import type { AdmikSettingsDto } from '@/lib/admik';
import {
  STORE_DEFAULTS,
  resolveShopName,
  resolveLogoUrl,
  resolveSeo,
  resolveContacts,
} from './store-settings';

/**
 * Тесты G-01 — резолвинг настроек магазина с фолбэком на дефолты витрины.
 * Чистые функции, без сети. Проверяем: null → дефолты; заданные значения →
 * переопределяют; пустые/пробельные значения → игнорируются (фолбэк).
 */

function dto(over: Partial<AdmikSettingsDto> = {}): AdmikSettingsDto {
  return {
    branding: {
      shopName: 'Acme Scrubs',
      logoUrl: 'https://cdn.test/logo.webp',
      faviconUrl: null,
      theme: { primaryColor: null, accentColor: null, mode: 'light' },
      supportEmail: null,
      supportPhone: null,
    },
    currency: { code: 'RUB', symbol: '₽', locale: 'ru-RU', fractionDigits: 2 },
    units: { weight: 'g', dimension: 'cm', system: 'metric' },
    contacts: {
      phone: '+7 999 123-45-67',
      email: 'info@acme.ru',
      address: null,
      workingHours: null,
      socials: [
        { type: 'Instagram', url: 'https://instagram.com/acme' },
        { type: 'Telegram', url: 'https://t.me/acme' },
      ],
    },
    legalEntity: { name: null, inn: null, kpp: null, ogrn: null, legalAddress: null },
    delivery: { freeDeliveryThreshold: 0 },
    seo: {
      siteName: 'Acme — рабочая одежда',
      siteUrl: null,
      titleTemplate: '%s — Acme',
      defaultDescription: 'Описание Acme',
      twitterSite: '@acme',
    },
    home: {
      hero: { title: null, subtitle: null, imageKey: null, ctaLabel: null, ctaHref: null },
      about: { title: 'О бренде', paragraphs: [], imageKeys: [], values: [] },
      quality: { title: 'Качество', items: [] },
      delivery: { items: [] },
    },
    ...over,
  };
}

describe('resolveShopName / resolveLogoUrl', () => {
  it('null → дефолт витрины', () => {
    expect(resolveShopName(null)).toBe(STORE_DEFAULTS.shopName);
    expect(resolveLogoUrl(null)).toBeNull();
  });
  it('значение из настроек переопределяет', () => {
    expect(resolveShopName(dto())).toBe('Acme Scrubs');
    expect(resolveLogoUrl(dto())).toBe('https://cdn.test/logo.webp');
  });
  it('пустое/пробельное имя → фолбэк', () => {
    const s = dto({ branding: { ...dto().branding, shopName: '   ' } });
    expect(resolveShopName(s)).toBe(STORE_DEFAULTS.shopName);
  });
});

describe('resolveSeo', () => {
  it('null → дефолты витрины', () => {
    const seo = resolveSeo(null);
    expect(seo.titleDefault).toBe(STORE_DEFAULTS.seo.titleDefault);
    expect(seo.titleTemplate).toBe(STORE_DEFAULTS.seo.titleTemplate);
    expect(seo.description).toBe(STORE_DEFAULTS.seo.description);
    expect(seo.siteName).toBe(STORE_DEFAULTS.shopName);
    expect(seo.twitterSite).toBeNull();
  });
  it('настройки переопределяют title/description/siteName', () => {
    const seo = resolveSeo(dto());
    expect(seo.titleDefault).toBe('Acme — рабочая одежда');
    expect(seo.titleTemplate).toBe('%s — Acme');
    expect(seo.description).toBe('Описание Acme');
    expect(seo.ogDescription).toBe('Описание Acme');
    expect(seo.siteName).toBe('Acme — рабочая одежда');
    expect(seo.twitterSite).toBe('@acme');
  });
  it('пустой siteName → siteName = имя магазина', () => {
    const s = dto({ seo: { ...dto().seo, siteName: '' } });
    expect(resolveSeo(s).siteName).toBe('Acme Scrubs');
  });
});

describe('resolveContacts', () => {
  it('null → плейсхолдеры витрины', () => {
    const c = resolveContacts(null);
    expect(c.phoneDisplay).toBe(STORE_DEFAULTS.contacts.phoneDisplay);
    expect(c.phoneTel).toBe(STORE_DEFAULTS.contacts.phoneTel);
    expect(c.email).toBe(STORE_DEFAULTS.contacts.email);
    expect(c.telegramUrl).toBe(STORE_DEFAULTS.contacts.telegramUrl);
    expect(c.socials).toEqual([]);
  });
  it('телефон → display как есть, tel только цифры/плюс', () => {
    const c = resolveContacts(dto());
    expect(c.phoneDisplay).toBe('+7 999 123-45-67');
    expect(c.phoneTel).toBe('+79991234567');
    expect(c.email).toBe('info@acme.ru');
  });
  it('находит Telegram среди соцсетей', () => {
    const c = resolveContacts(dto());
    expect(c.telegramUrl).toBe('https://t.me/acme');
    expect(c.telegramHandle).toBe('Telegram');
    expect(c.socials).toHaveLength(2);
  });
  it('telegram по url t.me даже без типа', () => {
    const s = dto({
      contacts: { ...dto().contacts, socials: [{ type: 'соцсеть', url: 'https://t.me/x' }] },
    });
    expect(resolveContacts(s).telegramUrl).toBe('https://t.me/x');
  });
});
