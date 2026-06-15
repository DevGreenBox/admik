/**
 * GET /robots.txt (docs/11 §5.3.4, пакет 5.S-1).
 *
 * core-always-on route handler. Правила собирает чистый билдер buildRobots по
 * NODE_ENV/настройкам: prod → Allow /, Disallow /admin,/api (кроме
 * /api/storefront); non-prod (NODE_ENV!=='production' ИЛИ seo.noindex_site) →
 * Disallow / (защита dev/staging). Домен Sitemap — из shop_settings.seo.site_url
 * (env только bootstrap-fallback). robots_extra дописывается в host-агностичном
 * виде, где это представимо в MetadataRoute.
 *
 * Fallback при недоступности БД — закрытый сайт (безопасный дефолт).
 */

import type { MetadataRoute } from 'next';

import { getEffectiveSettings } from '@/lib/config/settings';
import { buildRobots } from '@/lib/seo/robots';

/** Перегенерация раз в час (ISR). */
export const revalidate = 3600;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  let siteUrl: string | null = null;
  let noindexSite = false;
  let robotsExtra: string | null = null;
  try {
    const settings = await getEffectiveSettings();
    siteUrl = settings.seo.site_url ?? null;
    noindexSite = settings.seo.noindex_site;
    robotsExtra = settings.seo.robots_extra ?? null;
  } catch (error) {
    // Настройки недоступны → закрываем сайт (безопасный дефолт).
    console.error('[robots] настройки недоступны, закрываем сайт:', error);
    return { rules: { userAgent: '*', disallow: '/' } };
  }

  const built = buildRobots({ nodeEnv, siteUrl, noindexSite, robotsExtra });

  const result: MetadataRoute.Robots = {
    rules: built.rules,
    ...(built.sitemap ? { sitemap: built.sitemap } : {}),
  };
  return result;
}
