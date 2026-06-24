import path from "node:path";
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
  // Standalone-вывод для Docker: server.js + минимальный node_modules в .next/standalone.
  output: "standalone",
  // Витрина живёт внутри монорепо Admik (рядом есть pnpm-lock.yaml бэкенда) —
  // фиксируем корень трассировки на каталоге витрины, чтобы standalone собирал
  // правильный набор файлов и Next не путал workspace-root.
  outputFileTracingRoot: path.join(__dirname),
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1440],
    // Качество оптимизации (Next 16 требует список разрешённых значений; в 15
    // поле также поддерживается). Поднято до 85 — дефолтные 75 «замыливали»
    // премиальные фото каталога/обложек; <Image quality={85}> ниже использует его.
    qualities: [85],
    remotePatterns: buildRemotePatterns(),
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
};

export default nextConfig;
