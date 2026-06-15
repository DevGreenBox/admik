/**
 * GET /sitemap.xml (docs/11 §5.3.4, пакет 5.S-1).
 *
 * core-always-on route handler. Наполнение фильтруется по ЭФФЕКТИВНЫМ модулям
 * (env ⊕ module_overrides) и noindex/черновикам через чистый билдер
 * buildSitemapEntries. Домен берётся из shop_settings.seo.site_url (env только
 * bootstrap-fallback) — никаких process.env-доменов в проде.
 *
 * revalidate=3600 (ISR). Fallback при недоступности БД — только корень (паттерн
 * 2x2): карта не должна падать, если БД временно недоступна.
 */

import type { MetadataRoute } from 'next';

import { getEffectiveSettings, getEffectiveModules } from '@/lib/config/settings';
import { getSetting } from '@/lib/settings/repository';
import { parseSettingValue } from '@/lib/settings/schemas';
import { buildSitemapEntries } from '@/lib/seo/sitemap';
import { getSitemapRows } from '@/lib/seo/repository';

/** Перегенерация раз в час (ISR). */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const settings = await getEffectiveSettings();
    const siteUrl = settings.seo.site_url ?? null;

    // Эффективные модули: env-набор ⊕ module_overrides из БД.
    const overridesRow = await getSetting('module_overrides');
    const overrides = parseSettingValue('module_overrides', overridesRow?.value) ?? {};
    const modules = getEffectiveModules(process.env, overrides);

    const rows = await getSitemapRows();
    const entries = buildSitemapEntries(modules, rows, { siteUrl });

    return entries.map((e) => ({
      url: e.url,
      ...(e.lastModified ? { lastModified: e.lastModified } : {}),
    }));
  } catch (error) {
    // БД недоступна → отдаём только корень, чтобы карта не падала (паттерн 2x2).
    console.error('[sitemap] не удалось собрать карту, fallback на корень:', error);
    try {
      const settings = await getEffectiveSettings();
      const siteUrl = settings.seo.site_url;
      if (siteUrl) return [{ url: siteUrl.replace(/\/+$/, '') }];
    } catch {
      /* нет настроек — пустая карта */
    }
    return [];
  }
}
