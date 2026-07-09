/**
 * Конфигурация модуля cdek (docs/08 §2 «config.ts», §13.2 env).
 *
 * Чистое, тестируемое чтение CDEK_* из окружения (через lib/config/env Zod) +
 * настроек магазина (отправитель, тариф, габариты по умолчанию, IP-whitelist).
 *
 * КЛЮЧЕВОЕ: `isCdekMock()` — true при отсутствии CDEK_ACCOUNT/CDEK_SECRET. От
 * него зависит весь модуль: в mock-режиме клиент не ходит в сеть, расчёт идёт по
 * формуле, ПВЗ — из фикстур (см. docs/08 §11). Это позволяет demo-магазину и CI
 * работать без боевых ключей (ADR-002).
 *
 * КОНТУР ПО CDEK_TEST_MODE (аудит перехода в бой, 2026-07-09): при
 * CDEK_TEST_MODE=true baseUrl ЖЁСТКО равен CDEK_EDU_BASE_URL (тестовый
 * edu-контур), а CDEK_BASE_URL игнорируется. Раньше testMode читался, но не
 * влиял на baseUrl — половинчатая конфигурация (testMode=true + боевой URL)
 * била боевым трафиком по проду или наоборот. Теперь testMode — единственный
 * переключатель контура; CDEK_BASE_URL используется только в боевом режиме.
 */

import { getEnv, type Env } from '@/lib/config/env';
import type { PackageDims, CdekDeliveryMode } from './types';

/** Конфигурация отправителя (CDEK_SENDER_*). */
export interface CdekSenderConfig {
  name: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  inn: string | null;
}

/** Тестовый (edu) контур СДЭК API v2 — форсируется при CDEK_TEST_MODE=true. */
export const CDEK_EDU_BASE_URL = 'https://api.edu.cdek.ru';

/** Полная конфигурация модуля cdek (порт CdekConfig, docs/08 §2.1). */
export interface CdekConfig {
  baseUrl: string;
  account: string | null;
  secret: string | null;
  testMode: boolean;

  fromLocationCode: number;
  /** Адрес отправления (from_location.address заказов), null если не задан. */
  fromAddress: string | null;
  shipmentPoint: string | null;

  /** Тариф ПВЗ (склад-склад, дефолт 136). */
  defaultTariffCode: number;
  /** Тариф курьерской доставки «до двери» (склад-дверь, дефолт 137). */
  doorTariffCode: number;
  /** Тариф доставки в постамат (склад-постамат, дефолт 368 по Приложению 4). */
  postamatTariffCode: number;
  allowedTariffs: number[];

  sender: CdekSenderConfig;

  defaultDimensions: PackageDims;

  webhookSecret: string | null;
  webhookAllowedIps: string[];
  webhookTrustProxy: boolean;

  cronSecret: string | null;
  createEnabled: boolean;
  /**
   * Создавать накладную СДЭК сразу при оформлении заказа, БЕЗ ожидания оплаты
   * (магазины без онлайн-кассы). Дефолт false — штатно накладная только после
   * оплаты. Когда касса появится — выключить (вернётся гейт по оплате).
   */
  createOnOrder: boolean;
}

/**
 * Хардкод-фоллбэк габаритов последней инстанции (если и env пуст). Крупнее
 * carre fallback-ключа (250/28/28/6) под автотовары Gang Auto (docs/08 §3.3).
 */
export const CDEK_FALLBACK_DIMENSIONS: PackageDims = {
  weightG: 500,
  lengthCm: 30,
  widthCm: 20,
  heightCm: 10,
};

/** Парсит csv «1,2 ,3» → [1,2,3]; пустые/нечисловые отбрасывает. */
export function parseCsvInts(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

/** Парсит csv строк (IP/CIDR, домены) → массив без пустых. */
export function parseCsvStrings(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function nonEmpty(v: string | undefined): string | null {
  return v && v.length > 0 ? v : null;
}

/**
 * MOCK-режим (ключевая функция модуля): true, если не заданы боевые ключи
 * CDEK_ACCOUNT/CDEK_SECRET. Принимает опциональный source для юнит-тестов без
 * мутации process.env.
 */
export function isCdekMock(source?: Record<string, string | undefined>): boolean {
  const env = getEnv(source ?? process.env);
  return !nonEmpty(env.CDEK_ACCOUNT) || !nonEmpty(env.CDEK_SECRET);
}

/** Собирает конфигурацию отправителя из env. */
function buildSender(env: Env): CdekSenderConfig {
  return {
    name: nonEmpty(env.CDEK_SENDER_NAME),
    contactName: nonEmpty(env.CDEK_SENDER_CONTACT_NAME),
    phone: nonEmpty(env.CDEK_SENDER_PHONE),
    email: nonEmpty(env.CDEK_SENDER_EMAIL),
    inn: nonEmpty(env.CDEK_SENDER_INN),
  };
}

/** Дефолтные габариты упаковки из env (с фоллбэком, docs/08 §3.3). */
function buildDefaultDimensions(env: Env): PackageDims {
  return {
    weightG: env.CDEK_DEFAULT_WEIGHT_G,
    lengthCm: env.CDEK_DEFAULT_LENGTH_CM,
    widthCm: env.CDEK_DEFAULT_WIDTH_CM,
    heightCm: env.CDEK_DEFAULT_HEIGHT_CM,
  };
}

/**
 * Читает полную конфигурацию cdek из env. Принимает опциональный source для
 * тестируемости (как getEnv). Чистая: не кеширует, не ходит в сеть/БД.
 */
export function getCdekConfig(source?: Record<string, string | undefined>): CdekConfig {
  const env = getEnv(source ?? process.env);
  return {
    // testMode форсирует edu-контур; CDEK_BASE_URL действует только в бою (см. шапку).
    baseUrl: env.CDEK_TEST_MODE ? CDEK_EDU_BASE_URL : env.CDEK_BASE_URL,
    account: nonEmpty(env.CDEK_ACCOUNT),
    secret: nonEmpty(env.CDEK_SECRET),
    testMode: env.CDEK_TEST_MODE,

    fromLocationCode: env.CDEK_FROM_LOCATION_CODE,
    fromAddress: nonEmpty(env.CDEK_FROM_ADDRESS),
    shipmentPoint: nonEmpty(env.CDEK_SHIPMENT_POINT),

    defaultTariffCode: env.CDEK_DEFAULT_TARIFF,
    doorTariffCode: env.CDEK_DOOR_TARIFF,
    postamatTariffCode: env.CDEK_POSTAMAT_TARIFF,
    allowedTariffs: parseCsvInts(env.CDEK_ALLOWED_TARIFFS),

    sender: buildSender(env),

    defaultDimensions: buildDefaultDimensions(env),

    webhookSecret: nonEmpty(env.CDEK_WEBHOOK_SECRET),
    webhookAllowedIps: parseCsvStrings(env.CDEK_WEBHOOK_IPS),
    webhookTrustProxy: env.CDEK_WEBHOOK_TRUST_PROXY,

    cronSecret: nonEmpty(env.CDEK_CRON_SECRET),
    createEnabled: env.CDEK_CREATE_ENABLED,
    createOnOrder: env.CDEK_CREATE_ON_ORDER,
  };
}

/**
 * Тариф СДЭК по режиму доставки (M4 + аудит 2026-07-09): курьер «до двери»
 * (door) → doorTariffCode (склад-дверь, 137); постамат → postamatTariffCode
 * (склад-постамат, 368 по Приложению 4); ПВЗ/не задан → defaultTariffCode
 * (склад-склад, 136).
 *
 * Раньше постамат тарифицировался ПВЗ-тарифом 136 — неверный код (постамату
 * соответствует 368). Чистая и конфигурируемая (коды — из env, не зашиты под
 * конкретный магазин): мультитенантно переносится на любой ИМ.
 */
export function tariffForMode(
  cfg: CdekConfig,
  mode: CdekDeliveryMode | undefined,
): number {
  if (mode === 'door') return cfg.doorTariffCode;
  if (mode === 'postamat') return cfg.postamatTariffCode;
  return cfg.defaultTariffCode;
}
