/**
 * SECURITY (аудит 2026-07-18, находка #11). Зеркало набора payload'ов из
 * admik (tests/security/safe-href.test.ts): витрина — отдельное приложение со
 * своим tsconfig, импорт из корня admik невозможен, поэтому правила продублированы
 * руками в src/lib/safe-href.ts и обязаны совпадать. Если правила разошлись —
 * падает один из двух наборов.
 *
 * ВАЖНО: файл именно .test.ts, НЕ .tsx — vitest.config витрины использует
 * include=['src/**\/*.test.ts'], и .tsx молча не был бы запущен (ложно-зелёный прогон).
 */

import { describe, it, expect } from 'vitest';

import { isSafeHref, safeHref, safeHrefOr } from '@/lib/safe-href';

const UNSAFE = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  '  javascript:alert(1)',
  'java\nscript:alert(1)',
  'java\tscript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'DATA:text/html;base64,PHN2Zz4=',
  'vbscript:msgbox(1)',
  '//evil.example',
  '//evil.example/path',
  '/\\evil.com',
  '/\\\\evil.com',
  '\\\\evil.com',
  '/catalog\\..\\evil',
  'file:///etc/passwd',
  'ftp://evil.example',
  'catalog',
  'www.evil.com',
] as const;

const SAFE = [
  '/catalog',
  '/catalog?sale=1',
  '/#delivery',
  '#anchor',
  'https://evil.com',
  'https://shop.ru/catalog',
  'http://shop.ru',
  'mailto:a@b.c',
  'tel:+79990000000',
] as const;

describe('isSafeHref (витрина)', () => {
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

describe('safeHref / safeHrefOr (витрина)', () => {
  it('safeHref нормализует безопасное и обнуляет опасное', () => {
    expect(safeHref('  /catalog  ')).toBe('/catalog');
    expect(safeHref('/\\evil.com')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });

  it('safeHrefOr подставляет фолбэк вместо опасного значения', () => {
    // Первый экран главной обёрнут в <Link> целиком: ссылку нельзя «не отрендерить»,
    // поэтому опасное значение заменяется безопасным маршрутом, а не выбрасывается.
    expect(safeHrefOr('/\\evil.com', '/catalog')).toBe('/catalog');
    expect(safeHrefOr('javascript:alert(1)', '/catalog')).toBe('/catalog');
    expect(safeHrefOr('//evil.example', '/catalog')).toBe('/catalog');
    expect(safeHrefOr('/lookbook', '/catalog')).toBe('/lookbook');
    expect(safeHrefOr(undefined, '/catalog')).toBe('/catalog');
  });
});

describe('соответствие правил admik ↔ витрина', () => {
  it('обратный слэш блокируется в любой позиции (WHATWG трактует \\ как /)', () => {
    // new URL('/\\evil.com', 'https://shop.ru').href === 'https://evil.com/'
    expect(new URL('/\\evil.com', 'https://shop.ru').href).toBe('https://evil.com/');
    expect(isSafeHref('/\\evil.com')).toBe(false);
  });
});
