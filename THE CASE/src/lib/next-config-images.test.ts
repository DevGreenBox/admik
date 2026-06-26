import { describe, it, expect } from "vitest";
// Импортируем чистый билдер из корневого next.config (vite-node резолвит .ts).
import { buildRemotePatterns } from "../../next.config";

type Env = Record<string, string | undefined>;

describe("buildRemotePatterns — whitelisted-хосты next/image", () => {
  it("всегда включает localhost (dev MinIO/Caddy)", () => {
    const p = buildRemotePatterns({} as Env);
    expect(p).toContainEqual({ protocol: "http", hostname: "localhost" });
  });

  it("добавляет хост из NEXT_PUBLIC_ADMIK_API_URL", () => {
    const p = buildRemotePatterns({
      NEXT_PUBLIC_ADMIK_API_URL: "https://api.shop.ru",
    } as Env);
    expect(p).toContainEqual({ protocol: "https", hostname: "api.shop.ru" });
  });

  it("добавляет отдельный медиа-хост NEXT_PUBLIC_MEDIA_URL (S3/CDN на другом домене)", () => {
    const p = buildRemotePatterns({
      NEXT_PUBLIC_MEDIA_URL: "https://cdn.shop.ru",
    } as Env);
    expect(p).toContainEqual({ protocol: "https", hostname: "cdn.shop.ru" });
  });

  it("api + media: оба хоста проходят (мультитенантный сторадж)", () => {
    const p = buildRemotePatterns({
      NEXT_PUBLIC_ADMIK_API_URL: "https://api.shop.ru",
      NEXT_PUBLIC_MEDIA_URL: "https://media-cdn.example.net",
    } as Env);
    expect(p.some((x) => x.hostname === "api.shop.ru")).toBe(true);
    expect(p.some((x) => x.hostname === "media-cdn.example.net")).toBe(true);
  });

  it("дедуплицирует совпадающие хосты api/media (нет дублей)", () => {
    const p = buildRemotePatterns({
      NEXT_PUBLIC_ADMIK_API_URL: "https://api.shop.ru",
      NEXT_PUBLIC_MEDIA_URL: "https://api.shop.ru",
    } as Env);
    expect(p.filter((x) => x.hostname === "api.shop.ru")).toHaveLength(1);
  });

  it("невалидный URL игнорируется — прод-сборка не падает", () => {
    const p = buildRemotePatterns({
      NEXT_PUBLIC_ADMIK_API_URL: "not a url",
      NEXT_PUBLIC_MEDIA_URL: ":::://broken",
    } as Env);
    expect(p).toEqual([{ protocol: "http", hostname: "localhost" }]);
  });

  it("протокол берётся из URL (http медиа-хост → http-паттерн)", () => {
    const p = buildRemotePatterns({
      NEXT_PUBLIC_MEDIA_URL: "http://media.local",
    } as Env);
    expect(p).toContainEqual({ protocol: "http", hostname: "media.local" });
  });
});
