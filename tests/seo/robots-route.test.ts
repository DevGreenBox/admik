import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Тесты пакета 5.S-1 (docs/11 §5.3.6) — route handler app/robots.ts.
 *
 * Мокаем настройки — тест без БД. Проверяет: домен Sitemap из shop_settings;
 * NODE_ENV=test → Disallow / (защита non-prod); fallback при ошибке настроек →
 * закрытый сайт.
 */

const mocks = vi.hoisted(() => ({ effective: vi.fn() }));

vi.mock('@/lib/config/settings', () => ({ getEffectiveSettings: mocks.effective }));

beforeEach(() => {
  mocks.effective.mockResolvedValue({
    seo: { site_url: 'https://shop.example', noindex_site: false, robots_extra: null },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function disallows(r: any): string[] {
  const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
  return rules.flatMap((x: any) =>
    Array.isArray(x.disallow) ? x.disallow : x.disallow ? [x.disallow] : [],
  );
}

describe('app/robots — NODE_ENV=test (non-prod)', () => {
  it('NODE_ENV=test → Disallow / (закрыт)', async () => {
    // vitest выставляет NODE_ENV=test по умолчанию.
    const { default: robots } = await import('@/app/robots');
    const r = await robots();
    expect(disallows(r)).toContain('/');
  });

  it('домен Sitemap берётся из shop_settings.seo.site_url', async () => {
    const { default: robots } = await import('@/app/robots');
    const r = await robots();
    expect(r.sitemap).toBe('https://shop.example/sitemap.xml');
  });
});

describe('app/robots — fallback', () => {
  it('ошибка настроек → закрытый сайт (Disallow /)', async () => {
    mocks.effective.mockRejectedValue(new Error('no settings'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { default: robots } = await import('@/app/robots');
    const r = await robots();
    expect(disallows(r)).toContain('/');
    errSpy.mockRestore();
  });
});
