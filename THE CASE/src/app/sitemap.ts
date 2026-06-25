import { MetadataRoute } from "next";
import { listProducts } from "@/lib/admik";
import { getSiteUrlFromSources } from "@/lib/site-url";
import { getStoreSettings, resolveSeo } from "@/lib/store-settings";

// Рантайм-чтение env + домена из настроек (Находка-14). NEXT_PUBLIC_SITE_URL имеет
// приоритет над seo.siteUrl из админки (канонический домен стенда не подменяется).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const seo = resolveSeo(await getStoreSettings());
  const BASE = getSiteUrlFromSources(seo.siteUrl);
  let productUrls: MetadataRoute.Sitemap = [];
  try {
    const items = await listProducts({ limit: 200 });
    productUrls = items.map((p) => ({
      url: `${BASE}/product/${p.slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
  } catch {
    productUrls = [];
  }

  return [
    { url: BASE, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/catalog`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/search`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    ...productUrls,
  ];
}
