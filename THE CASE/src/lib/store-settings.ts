/**
 * Настройки магазина на витрине (G-01 / ADR-018).
 *
 * Витрина — потребитель Storefront API Admik. Этот модуль:
 *   1) тянет публичные настройки (`getStoreSettings`) на СЕРВЕРЕ с таймаутом и
 *      грациозной деградацией (сбой/таймаут/нет API → null → дефолты витрины);
 *   2) резолвит их в готовые значения с ФОЛБЭКОМ на текущие литералы витрины
 *      (`resolveShopName`/`resolveSeo`/`resolveContacts`) — чистые функции, легко
 *      тестируются без сети.
 *
 * Принцип мультитенантности: значения из админки Admik ПЕРЕОПРЕДЕЛЯЮТ дефолты;
 * пока магазин ничего не задал — витрина выглядит как сейчас. Новый магазин
 * меняет брендинг/контакты/SEO конфигом в админке, без правки кода витрины.
 */

import { cache } from 'react';
import { getSettings, type AdmikSettingsDto, type AdmikSocialDto } from '@/lib/admik';
import { DEFAULT_CURRENCY, type StorefrontCurrency } from './format';

// Контент главной — в client-safe модуле (без react/cache), реэкспорт для удобства.
export { HOME_FALLBACK, resolveHome, type ResolvedHome } from './home-content';

export interface NavLink {
  label: string;
  href: string;
}
export interface ResolvedNav {
  header: NavLink[];
  footer: { title: string; links: NavLink[] }[];
}

/**
 * Навигация витрины из настроек Admik (G-10/G-11). Возвращает заданные владельцем
 * пункты меню/колонки футера или ПУСТЫЕ массивы — в этом случае компоненты
 * (Header/Footer) показывают свою навигацию по умолчанию (фолбэк на их стороне,
 * включая динамическое подменю «Коллекция» из категорий).
 */
export function resolveNavigation(s: AdmikSettingsDto | null): ResolvedNav {
  return {
    header: s?.navigation?.header ?? [],
    footer: s?.navigation?.footer ?? [],
  };
}

/** Нейтральные дефолты витрины (фолбэк до первой правки в админке). */
export const STORE_DEFAULTS = {
  shopName: 'THE CASE',
  brandSubtitle: 'Medical Uniform',
  seo: {
    titleDefault: 'THE CASE — Premium Medical Uniform',
    titleTemplate: '%s | THE CASE',
    description:
      'Премиальная медицинская форма нового поколения. Comfort + Medicine. Минимализм, уверенность, чистые силуэты.',
    ogDescription: 'Comforts + Medicine = THE CASE. Премиальная медицинская униформа.',
  },
  contacts: {
    phoneDisplay: '+7 (___) ___-__-__',
    phoneTel: '+70000000000',
    email: 'hello@thecase.ru',
    telegramHandle: '@thecase',
    telegramUrl: 'https://t.me/thecase',
  },
} as const;

/**
 * Публичные настройки магазина (server-side, мемоизировано на запрос через
 * `cache`). Таймаут 2.5с + грациозная деградация: при сбое/таймауте/отсутствии
 * API возвращает null, и витрина показывает собственные дефолты (layout не
 * падает). Мемоизация дедуплицирует вызовы из layout и generateMetadata в рамках
 * одного рендера (один HTTP-запрос за настройками на страницу).
 */
export const getStoreSettings = cache(async (): Promise<AdmikSettingsDto | null> => {
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500));
    return await Promise.race([getSettings(), timeout]);
  } catch {
    return null;
  }
});

/** Непустая обрезанная строка либо null. */
function clean(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : null;
}

/** Имя магазина для логотипа/мета. Фолбэк — STORE_DEFAULTS.shopName. */
export function resolveShopName(s: AdmikSettingsDto | null): string {
  return clean(s?.branding.shopName) ?? STORE_DEFAULTS.shopName;
}

/** URL логотипа (картинка). null → текстовый логотип витрины. */
export function resolveLogoUrl(s: AdmikSettingsDto | null): string | null {
  return clean(s?.branding.logoUrl);
}

/** URL фавикона из брендинга. null → фавикон-ассет витрины по умолчанию. */
export function resolveFaviconUrl(s: AdmikSettingsDto | null): string | null {
  return clean(s?.branding.faviconUrl);
}

/** Цвета темы из брендинга (для CSS-переменных). null-поля → дефолтные стили витрины. */
export interface ResolvedTheme {
  primaryColor: string | null;
  accentColor: string | null;
}

export function resolveTheme(s: AdmikSettingsDto | null): ResolvedTheme {
  return {
    primaryColor: clean(s?.branding.theme.primaryColor),
    accentColor: clean(s?.branding.theme.accentColor),
  };
}

/**
 * Валюта витрины из settings.currency (Находка-13). Фолбэк по КАЖДОМУ полю на
 * DEFAULT_CURRENCY (₽, ru-RU, без копеек), чтобы частично заполненная настройка
 * не ломала формат. `fractionDigits` берётся из настроек как есть (0 — валидно),
 * клампится в разумные пределы Intl (0..20).
 */
export function resolveCurrency(s: AdmikSettingsDto | null): StorefrontCurrency {
  const cur = s?.currency;
  if (!cur) return DEFAULT_CURRENCY;
  const fd = Number.isFinite(cur.fractionDigits)
    ? Math.min(20, Math.max(0, Math.trunc(cur.fractionDigits)))
    : DEFAULT_CURRENCY.fractionDigits;
  return {
    code: clean(cur.code) ?? DEFAULT_CURRENCY.code,
    locale: clean(cur.locale) ?? DEFAULT_CURRENCY.locale,
    symbol: clean(cur.symbol),
    fractionDigits: fd,
  };
}

export interface ResolvedSeo {
  titleDefault: string;
  titleTemplate: string;
  description: string;
  ogDescription: string;
  siteName: string;
  twitterSite: string | null;
  /** Канонический домен из настроек (Находка-14); null → берётся ENV/дефолт. */
  siteUrl: string | null;
  /** Запрос на noindex из настроек (Находка-14); ENV имеет приоритет. */
  noindex: boolean | null;
}

/** SEO-метаданные с фолбэком на дефолты витрины. */
export function resolveSeo(s: AdmikSettingsDto | null): ResolvedSeo {
  const siteName = clean(s?.seo.siteName);
  const description = clean(s?.seo.defaultDescription);
  return {
    titleDefault: siteName ?? STORE_DEFAULTS.seo.titleDefault,
    titleTemplate: clean(s?.seo.titleTemplate) ?? STORE_DEFAULTS.seo.titleTemplate,
    description: description ?? STORE_DEFAULTS.seo.description,
    ogDescription: description ?? STORE_DEFAULTS.seo.ogDescription,
    siteName: siteName ?? resolveShopName(s),
    twitterSite: clean(s?.seo.twitterSite),
    siteUrl: clean(s?.seo.siteUrl),
    noindex: s?.seo.noindex ?? null,
  };
}

export interface ResolvedContacts {
  /** Телефон для показа (как ввёл владелец). */
  phoneDisplay: string;
  /** Телефон для tel: (только цифры/плюс). */
  phoneTel: string;
  email: string;
  /** Подпись Telegram (ник/метка) либо null. */
  telegramHandle: string | null;
  /** Ссылка Telegram либо null. */
  telegramUrl: string | null;
  /** Все соцссылки (для футера/контактов) — сырой список. */
  socials: AdmikSocialDto[];
}

const TELEGRAM_RE = /tele?gram|^tg$/i;

/** Распознаёт telegram-соцссылку среди настроек. */
function findTelegram(socials: AdmikSocialDto[]): AdmikSocialDto | undefined {
  return socials.find((x) => TELEGRAM_RE.test(x.type) || x.url.includes('t.me/'));
}

/** Контакты с фолбэком на текущие плейсхолдеры витрины. */
export function resolveContacts(s: AdmikSettingsDto | null): ResolvedContacts {
  const phone = clean(s?.contacts.phone);
  const email = clean(s?.contacts.email) ?? STORE_DEFAULTS.contacts.email;
  const socials = s?.contacts.socials ?? [];
  const tg = findTelegram(socials);
  return {
    phoneDisplay: phone ?? STORE_DEFAULTS.contacts.phoneDisplay,
    phoneTel: phone ? phone.replace(/[^\d+]/g, '') : STORE_DEFAULTS.contacts.phoneTel,
    email,
    telegramHandle: tg ? clean(tg.type) ?? 'Telegram' : STORE_DEFAULTS.contacts.telegramHandle,
    telegramUrl: tg?.url ?? STORE_DEFAULTS.contacts.telegramUrl,
    socials,
  };
}
