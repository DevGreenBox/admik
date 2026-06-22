/** Site URL for metadata, canonical links, checkout redirects. Set via NEXT_PUBLIC_SITE_URL.
 *  Читается из process.env при КАЖДОМ вызове (рантайм), а не кешируется на уровне модуля —
 *  иначе в standalone-сборке Next запекает build-time значение (localhost) в robots/sitemap. */
export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/** Закрыта ли витрина от индексации. Управляется рантайм-флагом STOREFRONT_NOINDEX
 *  (truthy: "1"/"true", регистр не важен). Для тестового/staging стенда — задан;
 *  для боевого магазина клиента — пуст (индексация открыта). Универсально для любой витрины. */
export function isNoindex(): boolean {
  const v = (process.env.STOREFRONT_NOINDEX ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}
