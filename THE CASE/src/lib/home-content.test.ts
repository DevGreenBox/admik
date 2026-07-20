/**
 * SECURITY (аудит 2026-07-18, находка #11). Контент главной приходит из настроек
 * Admik. Две ссылки отсюда рендерятся напрямую в <Link href>:
 *   • hero.ctaHref — в него обёрнут ВЕСЬ первый экран главной;
 *   • philosophy.linkHref — ссылка блока «философия».
 * Admik валидирует их на записи, но в БД могут лежать значения, записанные до
 * появления валидации или напрямую SQL. resolveHome — последний чистый рубеж:
 * небезопасное значение заменяется дефолтом витрины (ссылка обязана существовать).
 */

import { describe, it, expect } from 'vitest';

import { resolveHome, HOME_FALLBACK } from '@/lib/home-content';
import type { AdmikSettingsDto } from '@/lib/admik';

const UNSAFE = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  '//evil.example',
  '/\\evil.com',
  'catalog',
];

/** Минимальный DTO настроек с заданным блоком home. */
function dto(home: Record<string, unknown>): AdmikSettingsDto {
  return { home } as unknown as AdmikSettingsDto;
}

describe('resolveHome — санитизация ссылок (находка #11)', () => {
  it.each(UNSAFE)('hero.ctaHref %j заменяется дефолтом', (ctaHref) => {
    const r = resolveHome(dto({ hero: { ctaHref } }));
    expect(r.hero.ctaHref).toBe(HOME_FALLBACK.hero.ctaHref);
  });

  it.each(UNSAFE)('philosophy.linkHref %j заменяется дефолтом', (linkHref) => {
    const r = resolveHome(dto({ philosophy: { linkHref } }));
    expect(r.philosophy.linkHref).toBe(HOME_FALLBACK.philosophy.linkHref);
  });

  it('легитимные ссылки сохраняются как есть', () => {
    const r = resolveHome(
      dto({ hero: { ctaHref: '/lookbook' }, philosophy: { linkHref: '/#about' } }),
    );
    expect(r.hero.ctaHref).toBe('/lookbook');
    expect(r.philosophy.linkHref).toBe('/#about');
  });

  it('дефолты витрины сами по себе безопасны', () => {
    const r = resolveHome(null);
    expect(r.hero.ctaHref).toBe(HOME_FALLBACK.hero.ctaHref);
    expect(r.philosophy.linkHref).toBe(HOME_FALLBACK.philosophy.linkHref);
  });
});
