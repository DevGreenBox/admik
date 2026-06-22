import { MetadataRoute } from "next";
import { listProducts } from "@/lib/admik";
import { getSiteUrl } from "@/lib/site-url";

// Рантайм-чтение NEXT_PUBLIC_SITE_URL: иначе Next запекает build-time URL (localhost).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const BASE = getSiteUrl();
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
