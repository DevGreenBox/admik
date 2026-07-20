/**
 * SECURITY (аудит 2026-07-18, находка #11 — «закрыта частично»).
 *
 * Единый модуль проверки href (lib/security/safe-href.ts) и ОБЕ схемы, которые
 * раньше проверяли ссылки по-своему:
 *   • lib/cms/schemas.ts   — ctaHref/buttonHref/banner.href секций CMS;
 *   • lib/settings/schemas.ts — home.hero.ctaHref, home.philosophy.linkHref,
 *     navigation.header/footer[].links[].href.
 *
 * Пробелы, которые фиксирует этот набор:
 *  A. '/\evil.com' проходил обе проверки (startsWith('/') && !startsWith('//')),
 *     но WHATWG URL трактует '\' как '/' для special-схем:
 *     new URL('/\\evil.com', 'https://shop.ru').href === 'https://evil.com/'.
 *  B. в lib/settings/schemas.ts жила ВТОРАЯ hrefSchema с более слабым правилом
 *     (v.startsWith('/') || /^https?:\/\/\S+$/i…), пропускавшая '//evil.com'.
 */

import { describe, it, expect } from 'vitest';

import { isSafeHref, safeHref } from '@/lib/security/safe-href';
import { CmsSectionContentSchema } from '@/lib/cms/schemas';
import { homeSchema, navigationSchema } from '@/lib/settings/schemas';

/** Значения, которые ДОЛЖНЫ отвергаться любой из проверок. */
const UNSAFE = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  '  javascript:alert(1)',
  'java\nscript:alert(1)', // WHATWG URL выбрасывает \n → схема схлопывается в javascript:
  'java\tscript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'DATA:text/html;base64,PHN2Zz4=',
  'vbscript:msgbox(1)',
  '//evil.example',
  '//evil.example/path',
  '/\\evil.com', // «/\evil.com» — обратный слэш
  '/\\\\evil.com', // «/\\evil.com»
  '\\\\evil.com', // «\\evil.com» (UNC-подобное)
  '/catalog\\..\\evil', // '\' в любом месте значения
  'file:///etc/passwd',
  'ftp://evil.example',
  'catalog', // относительный путь без «/» — 404, а не маршрут
  'www.evil.com',
] as const;

/** Значения, которые ДОЛЖНЫ проходить (легитимный контент витрины). */
const SAFE = [
  '/catalog',
  '/catalog?sale=1',
  '/#delivery',
  '#anchor',
  'https://evil.com', // внешний http(s) — легитимный сценарий (ссылка на партнёра)
  'https://shop.ru/catalog',
  'http://shop.ru',
  'mailto:a@b.c',
  'tel:+79990000000',
] as const;

describe('isSafeHref — единый источник правды', () => {
  it.each(UNSAFE)('отвергает %j', (v) => {
    expect(isSafeHref(v)).toBe(false);
  });

  it.each(SAFE)('пропускает %j', (v) => {
    expect(isSafeHref(v)).toBe(true);
  });

  it('отвергает пустое/не-строку/слишком длинное', () => {
    expect(isSafeHref('')).toBe(false);
    expect(isSafeHref('   ')).toBe(false);
    expect(isSafeHref(null)).toBe(false);
    expect(isSafeHref(undefined)).toBe(false);
    expect(isSafeHref(42)).toBe(false);
    expect(isSafeHref('/' + 'a'.repeat(2048))).toBe(false);
  });
});

describe('safeHref — нормализация для рендера', () => {
  it('возвращает обрезанное значение для безопасного href', () => {
    expect(safeHref('  /catalog  ')).toBe('/catalog');
  });
  it('возвращает null для опасного href', () => {
    expect(safeHref('/\\evil.com')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});

describe('CMS: hrefSchema секций использует общий модуль', () => {
  const hero = (ctaHref: string) => ({
    type: 'hero' as const,
    title: 'T',
    ctaLabel: 'L',
    ctaHref,
  });

  it.each(UNSAFE)('hero.ctaHref отвергает %j', (v) => {
    expect(CmsSectionContentSchema.safeParse(hero(v)).success).toBe(false);
  });

  it.each(SAFE)('hero.ctaHref пропускает %j', (v) => {
    expect(CmsSectionContentSchema.safeParse(hero(v)).success).toBe(true);
  });

  it('banner.href отвергает обратный слэш', () => {
    const r = CmsSectionContentSchema.safeParse({
      type: 'banner',
      imageKey: 'k',
      href: '/\\evil.com',
    });
    expect(r.success).toBe(false);
  });
});

describe('Settings: вторая hrefSchema сведена к тому же модулю', () => {
  it.each(UNSAFE)('home.hero.ctaHref отвергает %j', (v) => {
    expect(homeSchema.safeParse({ hero: { ctaHref: v } }).success).toBe(false);
  });

  it.each(SAFE)('home.hero.ctaHref пропускает %j', (v) => {
    expect(homeSchema.safeParse({ hero: { ctaHref: v } }).success).toBe(true);
  });

  it.each(UNSAFE)('home.philosophy.linkHref отвергает %j', (v) => {
    expect(homeSchema.safeParse({ philosophy: { linkHref: v } }).success).toBe(false);
  });

  it.each(UNSAFE)('navigation.header[].href отвергает %j', (v) => {
    expect(
      navigationSchema.safeParse({ header: [{ label: 'X', href: v }] }).success,
    ).toBe(false);
  });

  it.each(UNSAFE)('navigation.footer[].links[].href отвергает %j', (v) => {
    expect(
      navigationSchema.safeParse({
        footer: [{ title: 'C', links: [{ label: 'X', href: v }] }],
      }).success,
    ).toBe(false);
  });

  it('навигация с легитимными ссылками сохраняется', () => {
    const r = navigationSchema.safeParse({
      header: [{ label: 'Каталог', href: '/catalog' }],
      footer: [{ title: 'Инфо', links: [{ label: 'Почта', href: 'mailto:a@b.c' }] }],
    });
    expect(r.success).toBe(true);
  });
});
