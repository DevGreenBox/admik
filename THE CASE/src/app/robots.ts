import { MetadataRoute } from "next";

import { getSiteUrlFromSources, isNoindexFromSources } from "@/lib/site-url";
import { getStoreSettings, resolveSeo } from "@/lib/store-settings";

// Рантайм-чтение env + настроек магазина (Находка-14). ENV (NEXT_PUBLIC_SITE_URL /
// STOREFRONT_NOINDEX) имеет приоритет над настройками админки (staging-защита):
// закрытый стенд нельзя случайно открыть из админки. Без env — решают настройки
// (домен/индексация из Admik). force-dynamic — иначе Next запечёт build-time значения.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const seo = resolveSeo(await getStoreSettings());
  const base = getSiteUrlFromSources(seo.siteUrl);

  // Стенд/настройка закрывают индексацию — отдаём «всё запрещено».
  if (isNoindexFromSources(seo.noindex)) {
    return {
      rules: { userAgent: "*", disallow: "/" },
      sitemap: `${base}/sitemap.xml`,
    };
  }

  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
