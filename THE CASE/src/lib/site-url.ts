/** Site URL & индексация витрины (Находка-14).
 *
 * Два источника: инфраструктурные ENV (NEXT_PUBLIC_SITE_URL / STOREFRONT_NOINDEX)
 * и настройки магазина из админки Admik (settings.seo.siteUrl / noindex). Политика
 * приоритета — ENV ГЛАВНЕЕ: это staging-защита (закрытый стенд нельзя случайно
 * открыть из админки, и канонический домен стенда не подменяется настройкой).
 * Если ENV не задан — берём значение из настроек; если и его нет — дефолт/откр.
 *
 * Базовые функции (`getSiteUrl`/`isNoindex`) читают только ENV и остаются
 * синхронными для совместимости. Резолверы с суффиксом ...FromSources чисто
 * комбинируют ENV + настройки (легко тестируются без сети). */

/** Сырое значение NEXT_PUBLIC_SITE_URL (или undefined). */
function envSiteUrl(): string | undefined {
  const v = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  return v.length > 0 ? v : undefined;
}

/** Задан ли инфраструктурный флаг индексации в ENV вообще (для приоритета). */
function envNoindexSet(): boolean {
  return (process.env.STOREFRONT_NOINDEX ?? "").trim().length > 0;
}

function isTruthy(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true";
}

/** Базовый URL из ENV. Читается при КАЖДОМ вызове (рантайм), не кешируется на
 *  уровне модуля — иначе standalone-сборка запекает build-time localhost. */
export function getSiteUrl(): string {
  return envSiteUrl() ?? "http://localhost:3000";
}

/** Закрыта ли витрина от индексации по ENV (STOREFRONT_NOINDEX: "1"/"true"). */
export function isNoindex(): boolean {
  const v = (process.env.STOREFRONT_NOINDEX ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * Базовый URL с учётом настроек магазина. Приоритет: ENV (если задан) → siteUrl
 * из админки → дефолт localhost. ENV главнее — канонический домен стенда не
 * подменяется настройкой магазина (staging-защита).
 */
export function getSiteUrlFromSources(settingsSiteUrl: string | null | undefined): string {
  const fromEnv = envSiteUrl();
  if (fromEnv) return fromEnv;
  const fromSettings = (settingsSiteUrl ?? "").trim();
  if (fromSettings.length > 0) return fromSettings;
  return "http://localhost:3000";
}

/**
 * Закрыта ли индексация с учётом настроек. Приоритет: ENV (если флаг ЗАДАН в
 * окружении — он решает, в т.ч. явное "0"/"false" = открыто) → noindex из
 * админки → открыто. То есть на staging (STOREFRONT_NOINDEX=1) сайт закрыт
 * независимо от админки; на боевом без ENV владелец может закрыть сайт
 * галочкой в админке.
 */
export function isNoindexFromSources(settingsNoindex: boolean | null | undefined): boolean {
  if (envNoindexSet()) return isTruthy(process.env.STOREFRONT_NOINDEX ?? "");
  return settingsNoindex === true;
}
