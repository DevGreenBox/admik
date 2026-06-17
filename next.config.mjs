/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Не бандлить в серверные чанки нативные пакеты — держать внешними, чтобы их
  // require'ил рантайм из node_modules, а не сломанная копия из бандла:
  //  • postgres — иначе db/seed/owner.mjs (ESM-скрипт init-shop) не находит пакет;
  //  • sharp — нативный libvips (@img/sharp-libvips-*) грузится через dlopen и НЕ
  //    трассируется в standalone Next.js; бандл-копия падает ERR_DLOPEN libvips-cpp.
  //    Рантайм-образ докладывает корректный sharp под платформу (Dockerfile, стадия `sharp`).
  serverExternalPackages: ['postgres', 'sharp'],
};

export default nextConfig;
