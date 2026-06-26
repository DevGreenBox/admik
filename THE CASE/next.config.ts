import path from "node:path";
import type { NextConfig } from "next";

type RemotePatterns = NonNullable<
  NonNullable<NextConfig["images"]>["remotePatterns"]
>;

/**
 * Хосты для next/image:
 *   - всегда localhost (dev MinIO/Caddy);
 *   - хост Admik API из NEXT_PUBLIC_ADMIK_API_URL;
 *   - ОТДЕЛЬНЫЙ медиа-хост из NEXT_PUBLIC_MEDIA_URL (S3/CDN на домене, отличном
 *     от API). Без него фон обложки и фото «О бренде», раздаваемые со стороннего
 *     стораджа, не проходили бы next/image и не отображались (находка #22).
 *
 * Мультитенантно: список собирается из env, без хардкода домена конкретного
 * магазина — онбординг нового ИМ с другим стораджем = настройка env, не правка кода.
 * Протокол берётся из самого URL; дубли хостов схлопываются.
 */
export function buildRemotePatterns(
  env: Record<string, string | undefined> = process.env,
): RemotePatterns {
  const patterns: RemotePatterns = [{ protocol: "http", hostname: "localhost" }];
  const seen = new Set<string>();

  const addHost = (raw: string | undefined) => {
    if (!raw) return;
    try {
      const { hostname, protocol } = new URL(raw);
      const proto = protocol === "http:" ? "http" : "https";
      const key = `${proto}//${hostname}`;
      if (seen.has(key)) return;
      seen.add(key);
      patterns.push({ protocol: proto, hostname });
    } catch {
      // Невалидный URL — пропускаем (прод-сборка не падает).
    }
  };

  addHost(env.NEXT_PUBLIC_ADMIK_API_URL);
  addHost(env.NEXT_PUBLIC_MEDIA_URL);

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
