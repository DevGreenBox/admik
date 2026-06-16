import { MetadataRoute } from "next";

import { getSiteUrl, isNoindex } from "@/lib/site-url";

// Рантайм-чтение env (NEXT_PUBLIC_SITE_URL / STOREFRONT_NOINDEX): без этого
// Next запекает build-time значения в standalone-сборку (localhost, открытая индексация).
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();

  // Стенд закрыт от индексации — отдаём «всё запрещено».
  if (isNoindex()) {
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
