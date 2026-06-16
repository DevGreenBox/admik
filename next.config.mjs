/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Не бандлить драйвер БД в серверные чанки — держать внешним пакетом, чтобы он
  // трассировался в standalone/node_modules. Иначе db/seed/owner.mjs (отдельный
  // ESM-скрипт init-shop) не находит пакет 'postgres' в рантайм-образе.
  serverExternalPackages: ['postgres'],
};

export default nextConfig;
