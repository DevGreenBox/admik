import type { NextConfig } from "next";

/** Хосты для next/image: всегда localhost (dev MinIO/Caddy) + хост Admik из env. */
function buildRemotePatterns(): NonNullable<
  NonNullable<NextConfig["images"]>["remotePatterns"]
> {
  const patterns: NonNullable<
    NonNullable<NextConfig["images"]>["remotePatterns"]
  > = [{ protocol: "http", hostname: "localhost" }];

  const apiUrl = process.env.NEXT_PUBLIC_ADMIK_API_URL;
  if (apiUrl) {
    try {
      const { hostname } = new URL(apiUrl);
      patterns.push({ protocol: "https", hostname });
    } catch {
      // Невалидный URL — не добавляем https-паттерн (прод-сборка не падает).
    }
  }

  return patterns;
}

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1440],
    remotePatterns: buildRemotePatterns(),
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
};

export default nextConfig;
