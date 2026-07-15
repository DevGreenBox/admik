import { describe, it, expect } from 'vitest';
import type { AdmikSettingsDto } from '@/lib/admik';
import {
  STORE_DEFAULTS,
  HOME_FALLBACK,
  resolveShopName,
  resolveLogoUrl,
  resolveFaviconUrl,
  resolveTheme,
  resolveCurrency,
  resolveSeo,
  resolveContacts,
  resolveHome,
  resolveNavigation,
} from './store-settings';
import { DEFAULT_CURRENCY } from './format';

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
      hero: { title: null, subtitle: null, imageUrl: null, ctaLabel: null, ctaHref: null },
      about: { title: 'О бренде', paragraphs: [], imageUrls: [], values: [] },
      quality: { title: 'Качество', items: [] },
      delivery: { items: [] },
      valuesStrip: { enabled: false, items: [] },
      philosophy: { eyebrow: '', title: '', text: '', linkLabel: '', linkHref: '' },
      reviews: {
        enabled: false,
        eyebrow: '',
        title: '',
        text: '',
        photos: [],
        ctaLabel: '',
        ctaHref: '',
      },
    },
    navigation: { header: [], footer: [] },
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

describe('resolveFaviconUrl / resolveTheme (Находка-12)', () => {
  it('null → нет фавикона и пустая тема', () => {
    expect(resolveFaviconUrl(null)).toBeNull();
    expect(resolveTheme(null)).toEqual({ primaryColor: null, accentColor: null });
  });
  it('фавикон и цвета из настроек переопределяют', () => {
    const s = dto({
      branding: {
        ...dto().branding,
        faviconUrl: 'https://cdn.test/favicon.ico',
        theme: { primaryColor: '#101820', accentColor: '#C8A96A', mode: 'light' },
      },
    });
    expect(resolveFaviconUrl(s)).toBe('https://cdn.test/favicon.ico');
    expect(resolveTheme(s)).toEqual({ primaryColor: '#101820', accentColor: '#C8A96A' });
  });
  it('пустые/пробельные цвета → null (фолбэк на стили витрины)', () => {
    const s = dto({
      branding: { ...dto().branding, theme: { primaryColor: '  ', accentColor: '', mode: 'light' } },
    });
    expect(resolveTheme(s)).toEqual({ primaryColor: null, accentColor: null });
  });
});

describe('resolveCurrency (Находка-13)', () => {
  it('null → дефолт витрины (₽, ru-RU, без копеек)', () => {
    expect(resolveCurrency(null)).toEqual(DEFAULT_CURRENCY);
  });
  it('берёт код/локаль/символ/знаки из настроек', () => {
    const s = dto({ currency: { code: 'USD', symbol: '$', locale: 'en-US', fractionDigits: 2 } });
    expect(resolveCurrency(s)).toEqual({ code: 'USD', symbol: '$', locale: 'en-US', fractionDigits: 2 });
  });
  it('пустые code/locale/symbol → пофилдовый фолбэк', () => {
    const s = dto({ currency: { code: '  ', symbol: '   ', locale: '', fractionDigits: 0 } });
    expect(resolveCurrency(s)).toEqual({
      code: DEFAULT_CURRENCY.code,
      locale: DEFAULT_CURRENCY.locale,
      symbol: null,
      fractionDigits: 0,
    });
  });
  it('fractionDigits клампится в пределы Intl (0..20)', () => {
    expect(resolveCurrency(dto({ currency: { code: 'RUB', symbol: null, locale: 'ru-RU', fractionDigits: 99 } })).fractionDigits).toBe(20);
    expect(resolveCurrency(dto({ currency: { code: 'RUB', symbol: null, locale: 'ru-RU', fractionDigits: -5 } })).fractionDigits).toBe(0);
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
    expect(seo.siteUrl).toBeNull();
    expect(seo.noindex).toBeNull();
  });
  it('siteUrl/noindex из настроек (Находка-14)', () => {
    const s = dto({ seo: { ...dto().seo, siteUrl: 'https://shop.ru', noindex: true } });
    const seo = resolveSeo(s);
    expect(seo.siteUrl).toBe('https://shop.ru');
    expect(seo.noindex).toBe(true);
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

describe('resolveHome', () => {
  it('null → дефолтный контент витрины (HOME_FALLBACK)', () => {
    expect(resolveHome(null)).toEqual(HOME_FALLBACK);
  });
  it('пустые блоки в настройках → фолбэк по полям', () => {
    // dto() имеет home с пустыми paragraphs/items/values
    const h = resolveHome(dto());
    expect(h.about.title).toBe('О бренде'); // из настроек
    expect(h.about.paragraphs).toEqual(HOME_FALLBACK.about.paragraphs); // пусто → фолбэк
    expect(h.quality.items).toEqual(HOME_FALLBACK.quality.items);
    expect(h.delivery.items).toEqual(HOME_FALLBACK.delivery.items);
    expect(h.hero.ctaLabel).toBe(HOME_FALLBACK.hero.ctaLabel);
  });
  it('заполненные блоки переопределяют дефолт', () => {
    const s = dto({
      home: {
        ...dto().home,
        hero: { title: 'Привет', subtitle: 'Саб', imageUrl: 'https://cdn/hero.webp', ctaLabel: 'В каталог', ctaHref: '/c' },
        about: { title: 'Наш бренд', paragraphs: ['p1', 'p2'], imageUrls: ['https://cdn/a.webp'], values: ['v1'] },
        quality: { title: 'Ткань', items: ['и1', 'и2'] },
        delivery: { items: [{ title: 'Почта', text: 'быстро' }] },
      },
    });
    const h = resolveHome(s);
    expect(h.hero).toEqual({ title: 'Привет', subtitle: 'Саб', imageUrl: 'https://cdn/hero.webp', ctaLabel: 'В каталог', ctaHref: '/c' });
    expect(h.about.paragraphs).toEqual(['p1', 'p2']);
    expect(h.about.imageUrls).toEqual(['https://cdn/a.webp']);
    expect(h.about.values).toEqual(['v1']);
    expect(h.quality).toEqual({ title: 'Ткань', items: ['и1', 'и2'] });
    expect(h.delivery.items).toEqual([{ title: 'Почта', text: 'быстро' }]);
  });

  // B1 — лента ценностей: по умолчанию скрыта; включается из настроек.
  it('null → лента скрыта (HOME_FALLBACK.valuesStrip.enabled = false)', () => {
    expect(resolveHome(null).valuesStrip.enabled).toBe(false);
    expect(HOME_FALLBACK.valuesStrip.enabled).toBe(false);
    expect(HOME_FALLBACK.valuesStrip.items.length).toBe(3);
  });

  it('valuesStrip enabled+items из настроек проброшены', () => {
    const s = dto({
      home: {
        ...dto().home,
        valuesStrip: { enabled: true, items: [{ title: 'Форма', text: 'описание' }] },
      },
    });
    const h = resolveHome(s);
    expect(h.valuesStrip.enabled).toBe(true);
    expect(h.valuesStrip.items).toEqual([{ title: 'Форма', text: 'описание' }]);
  });

  it('valuesStrip enabled:true без items → дефолтные items (фолбэк по полю)', () => {
    const s = dto({
      home: { ...dto().home, valuesStrip: { enabled: true, items: [] } },
    });
    const h = resolveHome(s);
    expect(h.valuesStrip.enabled).toBe(true);
    expect(h.valuesStrip.items).toEqual(HOME_FALLBACK.valuesStrip.items);
  });

  // B3 — философия: фолбэк по полям + оверрайд.
  it('пустая philosophy → фолбэк (eyebrow «Философия»)', () => {
    const h = resolveHome(dto());
    expect(h.philosophy).toEqual(HOME_FALLBACK.philosophy);
    expect(h.philosophy.eyebrow).toBe('Философия');
  });

  it('philosophy из настроек переопределяет', () => {
    const s = dto({
      home: {
        ...dto().home,
        philosophy: { eyebrow: 'Манифест', title: 'T', text: 'X', linkLabel: 'L', linkHref: '/x' },
      },
    });
    expect(resolveHome(s).philosophy).toEqual({
      eyebrow: 'Манифест',
      title: 'T',
      text: 'X',
      linkLabel: 'L',
      linkHref: '/x',
    });
  });

  // Блок фото-отзывов «ВЫ + THE CASE»: по умолчанию скрыт (opt-in), как valuesStrip.
  it('null → блок отзывов скрыт (HOME_FALLBACK.reviews.enabled = false, title «ВЫ + THE CASE»)', () => {
    expect(resolveHome(null).reviews.enabled).toBe(false);
    expect(HOME_FALLBACK.reviews.enabled).toBe(false);
    expect(HOME_FALLBACK.reviews.title).toBe('ВЫ + THE CASE');
    expect(HOME_FALLBACK.reviews.photos).toEqual([]);
  });

  it('пустой reviews в настройках → фолбэк по полям (title «ВЫ + THE CASE»)', () => {
    // dto().home.reviews имеет пустые eyebrow/title/text/ctaLabel/ctaHref и photos:[]
    const h = resolveHome(dto());
    expect(h.reviews).toEqual(HOME_FALLBACK.reviews);
    expect(h.reviews.enabled).toBe(false);
    expect(h.reviews.title).toBe(HOME_FALLBACK.reviews.title);
    expect(h.reviews.photos).toEqual([]);
  });

  it('reviews enabled+поля+фото из настроек проброшены (переопределяют дефолт)', () => {
    const s = dto({
      home: {
        ...dto().home,
        reviews: {
          enabled: true,
          eyebrow: 'Наши клиенты',
          title: 'ВЫ + ACME',
          text: 'Реальные фото клиентов.',
          photos: ['https://cdn/r1.webp', 'https://cdn/r2.webp'],
          ctaLabel: 'Прислать фото',
          ctaHref: '/contacts',
        },
      },
    });
    const h = resolveHome(s);
    expect(h.reviews.enabled).toBe(true);
    expect(h.reviews.eyebrow).toBe('Наши клиенты');
    expect(h.reviews.title).toBe('ВЫ + ACME');
    expect(h.reviews.text).toBe('Реальные фото клиентов.');
    expect(h.reviews.photos).toEqual(['https://cdn/r1.webp', 'https://cdn/r2.webp']);
    expect(h.reviews.ctaLabel).toBe('Прислать фото');
    expect(h.reviews.ctaHref).toBe('/contacts');
  });

  it('reviews enabled:true, пустые тексты → фолбэк по полю, флаг уважается', () => {
    const s = dto({
      home: {
        ...dto().home,
        reviews: {
          enabled: true,
          eyebrow: '',
          title: '',
          text: '',
          photos: [],
          ctaLabel: '',
          ctaHref: '',
        },
      },
    });
    const h = resolveHome(s);
    expect(h.reviews.enabled).toBe(true); // флаг из настроек уважается
    expect(h.reviews.title).toBe(HOME_FALLBACK.reviews.title); // пусто → фолбэк
    expect(h.reviews.eyebrow).toBe(HOME_FALLBACK.reviews.eyebrow);
    expect(h.reviews.photos).toEqual([]);
  });

  it('reviews.photos фильтрует пустые/пробельные строки', () => {
    const s = dto({
      home: {
        ...dto().home,
        reviews: {
          enabled: true,
          eyebrow: 'e',
          title: 't',
          text: 'x',
          photos: ['https://cdn/ok.webp', '', '   '],
          ctaLabel: 'c',
          ctaHref: '/c',
        },
      },
    });
    expect(resolveHome(s).reviews.photos).toEqual(['https://cdn/ok.webp']);
  });

  // about: дефолт витрины без слова Fashion (клиент просил «Comfort + Medicine»).
  it('HOME_FALLBACK.about без слова Fashion (Comfort + Medicine)', () => {
    expect(HOME_FALLBACK.about.values[0]).toBe('Comfort + Medicine');
    expect(HOME_FALLBACK.about.paragraphs[0]).toContain('Comfort + Medicine');
    expect(HOME_FALLBACK.about.paragraphs[0]).not.toContain('Fashion');
  });
});

describe('resolveNavigation', () => {
  it('null → пустые массивы (витрина покажет дефолтную навигацию)', () => {
    expect(resolveNavigation(null)).toEqual({ header: [], footer: [] });
  });
  it('берёт меню/колонки из настроек', () => {
    const s = dto({
      navigation: {
        header: [{ label: 'Каталог', href: '/catalog' }],
        footer: [{ title: 'Сервис', links: [{ label: 'Доставка', href: '/d' }] }],
      },
    });
    const n = resolveNavigation(s);
    expect(n.header).toEqual([{ label: 'Каталог', href: '/catalog' }]);
    expect(n.footer[0]).toEqual({ title: 'Сервис', links: [{ label: 'Доставка', href: '/d' }] });
  });
});
