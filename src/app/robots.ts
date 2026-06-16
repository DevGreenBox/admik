import { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/site-url";

const BASE = getSiteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
