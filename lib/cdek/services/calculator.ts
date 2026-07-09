/**
 * Calculator — расчёт стоимости/срока доставки СДЭК (docs/08 §5, порт carre
 * Calculator.php).
 *
 * Выбор источника данных — по getCdekManager().isMock (docs/08 §11):
 *   • isMock → mock-функции (формула §5.3, lib/cdek/mock);
 *   • иначе  → manager.client.request к /v2/calculator/{tariff,tarifflist} с
 *             маппингом snake_case ответа СДЭК в доменный CdekTariffResult.
 *
 * from_location — ВСЕГДА серверный, из входа не берётся (анти-tamper, docs/08
 * §6.1, ADR-010). При заданном CDEK_SHIPMENT_POINT real-ветка резолвит КОД
 * ГОРОДА этого ПВЗ через GET /v2/deliverypoints?code=… (кеш в памяти модуля,
 * TTL 1 час) — иначе котировка шла от CDEK_FROM_LOCATION_CODE (дефолт 44
 * Москва) и расходилась с фактической накладной, создаваемой от ПВЗ отгрузки
 * (аудит перехода в бой 2026-07-09). При сбое резолва — фоллбэк на
 * fromLocationCode (один console.warn на ключ ПВЗ).
 *
 * БОЕВЫЕ БЮДЖЕТЫ ВИТРИННОГО ПУТИ: расчёт стоит на пути чекаута, поэтому real-
 * запросы калькулятора идут с timeoutMs=10000, maxNetworkRetries=1 и
 * idempotent=true (расчёт безопасен к авто-повтору; транспорт после волны 1 НЕ
 * ретраит POST без этой пометки). Результат расчёта по тарифу кешируется на
 * 300с (Redis при REDIS_URL через TokenStore-абстракцию token-cache, иначе
 * память; фоллбэк на память при недоступности Redis) — без кеша каждый шаг
 * чекаута бил живой POST /v2/calculator/tariff при общем лимите СДЭК 200 RPS.
 * Кеш применяется ТОЛЬКО в real-ветке (mock мгновенный и без сети).
 *
 * Хелпер aggregatePackage — чистая агрегация веса/габаритов корзины в одну
 * упаковку (вес/высота — Σ(qty*x), Д/Ш — max), тестируется без сети.
 */

import { createHash } from 'node:crypto';
import type { CdekManager } from '../manager';
import {
  CDEK_FALLBACK_DIMENSIONS,
  type CdekConfig,
} from '../config';
import { CdekError, type CdekApiError } from '../errors';
import { getDefaultTokenStore } from '../token-cache';
import type {
  CdekLocation,
  CdekPackage,
  CdekTariffOption,
  CdekTariffResult,
  PackageDims,
} from '../types';

// -----------------------------------------------------------------------------
// Агрегация корзины в упаковку (чистая функция).
// -----------------------------------------------------------------------------

/**
 * Позиция корзины с (опциональными) габаритами товара/варианта (миграция 0018).
 * null/undefined → дефолт магазина. Вес варианта переопределяет вес товара —
 * это решает вызывающий, передавая итоговые weightG/… на позицию.
 */
export interface CartLineDims {
  qty: number;
  weightG?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

/**
 * Агрегирует позиции корзины в одну упаковку СДЭК (docs/08 §7.1 packages):
 *   weight = Σ(weightG × qty); length/width = max; height = Σ(heightG × qty).
 * Пустые/NULL поля позиции → дефолт магазина (defaults) → фоллбэк последней
 * инстанции (CDEK_FALLBACK_DIMENSIONS). Пустая корзина → одна дефолтная упаковка.
 * Чистая, детерминированная.
 */
export function aggregatePackage(
  lines: readonly CartLineDims[],
  defaults: PackageDims = CDEK_FALLBACK_DIMENSIONS,
): CdekPackage {
  if (lines.length === 0) {
    return {
      weight: defaults.weightG,
      length: defaults.lengthCm,
      width: defaults.widthCm,
      height: defaults.heightCm,
    };
  }

  let weight = 0;
  let length = 0;
  let width = 0;
  let height = 0;

  for (const line of lines) {
    const qty = Math.max(1, line.qty || 1);
    const w = line.weightG ?? defaults.weightG;
    const l = line.lengthCm ?? defaults.lengthCm;
    const wd = line.widthCm ?? defaults.widthCm;
    const h = line.heightCm ?? defaults.heightCm;

    weight += w * qty;
    height += h * qty;
    length = Math.max(length, l);
    width = Math.max(width, wd);
  }

  return { weight, length, width, height };
}

// -----------------------------------------------------------------------------
// Вход расчёта.
// -----------------------------------------------------------------------------

/** Вход расчёта по конкретному тарифу. */
export interface CalculateInput {
  /** Назначение: код города / индекс / адрес. */
  to: CdekLocation;
  /** Готовые упаковки (если уже агрегированы вызывающим). */
  packages?: CdekPackage[];
  /** ИЛИ позиции корзины — будут агрегированы в одну упаковку. */
  lines?: readonly CartLineDims[];
  /** Код тарифа; дефолт — CdekConfig.defaultTariffCode. */
  tariffCode?: number;
}

/** Вход расчёта списка доступных тарифов. */
export interface CalculateAvailableInput {
  to: CdekLocation;
  packages?: CdekPackage[];
  lines?: readonly CartLineDims[];
  /** type для tarifflist: 1 = интернет-магазин (default СДЭК), 2 = доставка. */
  type?: number;
}

// -----------------------------------------------------------------------------
// Кеши real-ветки: бюджеты запросов, котировки (TTL 300с), город ПВЗ отгрузки
// (TTL 1 час). Модульные — переживают инстансы Calculator в рамках процесса.
// -----------------------------------------------------------------------------

/** Таймаут real-запросов калькулятора (мс) — витринный путь, не дефолтные 30с. */
const CALC_TIMEOUT_MS = 10_000;
/** Сетевых ретраев на витринном пути (лимит СДЭК 200 RPS на всех клиентов). */
const CALC_MAX_NETWORK_RETRIES = 1;

/** TTL кеша котировок (с): цены СДЭК стабильны в пределах минут. */
const QUOTE_CACHE_TTL_SEC = 300;
/** TTL кеша «код города ПВЗ отгрузки» (мс): ПВЗ переезжает редко. */
const SHIPMENT_POINT_CITY_TTL_MS = 3_600_000;

/**
 * In-memory фоллбэк кеша котировок: используется, когда Redis-хранилище
 * (getDefaultTokenStore при REDIS_URL) недоступно/падает. Без REDIS_URL
 * getDefaultTokenStore сам отдаёт MemoryTokenStore — фоллбэк не задействуется.
 */
const quoteMemFallback = new Map<string, { value: string; expiresAt: number }>();
let quoteStoreWarned = false;

/** Кеш кода города ПВЗ отгрузки (ключ — код ПВЗ, значение — city_code + дедлайн). */
const shipmentPointCityCache = new Map<string, { cityCode: number; expiresAt: number }>();
/** ПВЗ, по которым фоллбэк-warn уже выдан (ровно один console.warn на ключ). */
const shipmentPointWarned = new Set<string>();

/** Сбрасывает модульные кеши калькулятора (для тестов). */
export function resetCalculatorRuntimeCaches(): void {
  quoteMemFallback.clear();
  quoteStoreWarned = false;
  shipmentPointCityCache.clear();
  shipmentPointWarned.clear();
}

/** Ключ кеша котировки: hash от контура (baseUrl) + полного тела запроса
 *  (from/to/tariff/packages — режим доставки кодируется тарифом). */
function quoteCacheKey(baseUrl: string, body: unknown): string {
  const hash = createHash('sha256')
    .update(baseUrl)
    .update(' ')
    .update(JSON.stringify(body))
    .digest('hex');
  return `cdek:calc:quote:${hash}`;
}

function warnQuoteStoreOnce(err: unknown): void {
  if (quoteStoreWarned) return;
  quoteStoreWarned = true;
  console.warn(
    `[cdek] кеш котировок: Redis недоступен (${(err as Error)?.message ?? err}) — ` +
      'работаю через память процесса.',
  );
}

/** Чтение котировки из кеша (Redis → память при сбое). null — промах. */
async function quoteCacheGet(key: string): Promise<CdekTariffResult | null> {
  let rawValue: string | null = null;
  try {
    const store = await getDefaultTokenStore();
    rawValue = await store.get(key);
  } catch (err) {
    warnQuoteStoreOnce(err);
    const hit = quoteMemFallback.get(key);
    if (hit && hit.expiresAt > Date.now()) rawValue = hit.value;
    else quoteMemFallback.delete(key);
  }
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as CdekTariffResult;
    // Минимальная проверка формы: битые/чужие значения не отдаём как котировку.
    if (typeof parsed?.deliverySum !== 'string' || typeof parsed?.tariffCode !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Запись котировки в кеш (Redis → память при сбое), TTL QUOTE_CACHE_TTL_SEC. */
async function quoteCacheSet(key: string, result: CdekTariffResult): Promise<void> {
  const value = JSON.stringify(result);
  try {
    const store = await getDefaultTokenStore();
    await store.set(key, value, QUOTE_CACHE_TTL_SEC);
  } catch (err) {
    warnQuoteStoreOnce(err);
    quoteMemFallback.set(key, {
      value,
      expiresAt: Date.now() + QUOTE_CACHE_TTL_SEC * 1000,
    });
  }
}

/** Достаёт location.city_code первого офиса из ответа GET /v2/deliverypoints. */
function extractShipmentCityCode(raw: unknown): number | null {
  if (!Array.isArray(raw)) return null;
  for (const office of raw) {
    if (!office || typeof office !== 'object') continue;
    const location = (office as Record<string, unknown>).location;
    if (!location || typeof location !== 'object') continue;
    const cityCode = (location as Record<string, unknown>).city_code;
    const n = Number(cityCode);
    if (cityCode !== null && cityCode !== undefined && Number.isFinite(n)) {
      return Math.trunc(n);
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Маппинг snake_case ответа СДЭК → домен.
// -----------------------------------------------------------------------------

/** Деньги из ответа СДЭК (число/строка) → строка NUMERIC(14,2). */
function toMoney(v: unknown): string {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0;
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Достаёт structured errors[] из тела ответа СДЭК (поле `errors`). */
function extractCdekErrors(raw: Record<string, unknown>): CdekApiError[] {
  const errs = raw.errors;
  if (!Array.isArray(errs)) return [];
  return errs
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      code: typeof e.code === 'string' ? e.code : 'unknown',
      message: typeof e.message === 'string' ? e.message : '',
    }));
}

/**
 * Маппинг ответа /v2/calculator/tariff → CdekTariffResult.
 *
 * BUG B (anti-undercharge): СДЭК отвечает HTTP 200 даже когда тариф недоступен —
 * тело тогда несёт непустой errors[] и НЕ содержит delivery_sum/total_sum. Раньше
 * отсутствующее поле проходило через toMoney(undefined) === '0.00', Calculator
 * резолвился с нулевой ценой (resolved-путь), и заказ создавался с БЕСПЛАТНОЙ
 * доставкой (клиент недоплачивал). Поэтому ДО маппинга требуем конечную цену и
 * отсутствие errors[]: иначе бросаем CdekError — выше по стеку он превращается в
 * DeliveryCalculationError (createOrder → delivery_unavailable; quote softFail →
 * resolved:false). Легитимный нуль (delivery_sum: 0 без errors) остаётся '0.00'.
 */
function mapTariffResult(raw: Record<string, unknown>, tariffCode: number): CdekTariffResult {
  const priceRaw = raw.delivery_sum ?? raw.total_sum;
  const price =
    typeof priceRaw === 'string'
      ? Number(priceRaw)
      : typeof priceRaw === 'number'
        ? priceRaw
        : NaN;
  const cdekErrors = extractCdekErrors(raw);
  if (!Number.isFinite(price) || cdekErrors.length > 0) {
    throw new CdekError('cdek_calc_no_price', 'СДЭК калькулятор не вернул цену доставки.', {
      cdekErrors,
    });
  }
  return {
    deliverySum: price.toFixed(2),
    periodMin: toIntOrNull(raw.period_min),
    periodMax: toIntOrNull(raw.period_max),
    tariffCode: toIntOrNull(raw.tariff_code) ?? tariffCode,
  };
}

function mapTariffOption(raw: Record<string, unknown>): CdekTariffOption {
  return {
    tariffCode: toIntOrNull(raw.tariff_code) ?? 0,
    tariffName: typeof raw.tariff_name === 'string' ? raw.tariff_name : null,
    deliverySum: toMoney(raw.delivery_sum ?? raw.total_sum),
    periodMin: toIntOrNull(raw.period_min),
    periodMax: toIntOrNull(raw.period_max),
    deliveryMode: toIntOrNull(raw.delivery_mode),
  };
}

// -----------------------------------------------------------------------------
// Calculator.
// -----------------------------------------------------------------------------

export class Calculator {
  constructor(private readonly manager: CdekManager) {}

  private get config(): CdekConfig {
    return this.manager.config;
  }

  /**
   * Серверная локация отправления (анти-tamper). При заданном CDEK_SHIPMENT_POINT
   * резолвит код ГОРОДА ПВЗ отгрузки через GET /v2/deliverypoints?code=…
   * (идемпотентный GET; кеш модуля, TTL 1 час) — иначе котировка от
   * fromLocationCode расходится с накладной, создаваемой от ПВЗ. При сбое
   * резолва — фоллбэк на fromLocationCode + один console.warn на ключ.
   * Вызывается ТОЛЬКО в real-ветке (в mock client недоступен).
   */
  private async resolveFromLocation(): Promise<CdekLocation> {
    const cfg = this.config;
    const point = cfg.shipmentPoint;
    if (!point) return { code: cfg.fromLocationCode };

    const hit = shipmentPointCityCache.get(point);
    if (hit && hit.expiresAt > Date.now()) return { code: hit.cityCode };

    try {
      const raw = await this.manager.client.request<unknown>('GET', '/v2/deliverypoints', {
        query: { code: point },
        timeoutMs: CALC_TIMEOUT_MS,
        maxNetworkRetries: CALC_MAX_NETWORK_RETRIES,
      });
      const cityCode = extractShipmentCityCode(raw);
      if (cityCode !== null) {
        shipmentPointCityCache.set(point, {
          cityCode,
          expiresAt: Date.now() + SHIPMENT_POINT_CITY_TTL_MS,
        });
        return { code: cityCode };
      }
    } catch {
      // Сбой резолва не должен ронять расчёт — фоллбэк ниже.
    }

    if (!shipmentPointWarned.has(point)) {
      shipmentPointWarned.add(point);
      console.warn(
        `[cdek] не удалось определить город ПВЗ отгрузки «${point}» ` +
          `(GET /v2/deliverypoints) — котировка от CDEK_FROM_LOCATION_CODE=${cfg.fromLocationCode}.`,
      );
    }
    return { code: cfg.fromLocationCode };
  }

  /** packages из входа: явные packages ИЛИ агрегация позиций корзины. */
  private resolvePackages(input: { packages?: CdekPackage[]; lines?: readonly CartLineDims[] }): CdekPackage[] {
    if (input.packages && input.packages.length > 0) return input.packages;
    if (input.lines) return [aggregatePackage(input.lines, this.config.defaultDimensions)];
    return [aggregatePackage([], this.config.defaultDimensions)];
  }

  /**
   * Расчёт по конкретному тарифу (POST /v2/calculator/tariff).
   * В mock — формула §5.3; в real — запрос с витринными бюджетами
   * (10с/1 ретрай/idempotent) + кеш результата на 300с + маппинг ответа.
   * «Тариф недоступен» (CdekError cdek_calc_no_price) НЕ кешируется.
   */
  async calculate(input: CalculateInput): Promise<CdekTariffResult> {
    const tariffCode = input.tariffCode ?? this.config.defaultTariffCode;
    const packages = this.resolvePackages(input);

    if (this.manager.isMock) {
      return this.manager.mock.mockCalculateByTariff(tariffCode, packages);
    }

    const body = {
      tariff_code: tariffCode,
      from_location: toApiLocation(await this.resolveFromLocation()),
      to_location: toApiLocation(input.to),
      packages,
    };

    const cacheKey = quoteCacheKey(this.config.baseUrl, body);
    const cached = await quoteCacheGet(cacheKey);
    if (cached) return cached;

    const raw = await this.manager.client.request<Record<string, unknown>>(
      'POST',
      '/v2/calculator/tariff',
      {
        json: body,
        timeoutMs: CALC_TIMEOUT_MS,
        maxNetworkRetries: CALC_MAX_NETWORK_RETRIES,
        // Расчёт стоимости безопасен к авто-повтору (ничего не создаёт).
        idempotent: true,
      },
    );
    const result = mapTariffResult(raw ?? {}, tariffCode);
    await quoteCacheSet(cacheKey, result);
    return result;
  }

  /**
   * Список доступных тарифов (POST /v2/calculator/tarifflist; type=1 —
   * «интернет-магазин», default СДЭК; 2 — «доставка»).
   * В mock — фикстурный набор; в real — запрос + маппинг tariff_codes[].
   */
  async calculateAvailable(input: CalculateAvailableInput): Promise<CdekTariffOption[]> {
    const packages = this.resolvePackages(input);

    if (this.manager.isMock) {
      return this.manager.mock.mockCalculateAvailable(packages);
    }

    const raw = await this.manager.client.request<Record<string, unknown>>(
      'POST',
      '/v2/calculator/tarifflist',
      {
        json: {
          type: input.type ?? 1,
          from_location: toApiLocation(await this.resolveFromLocation()),
          to_location: toApiLocation(input.to),
          packages,
        },
        timeoutMs: CALC_TIMEOUT_MS,
        maxNetworkRetries: CALC_MAX_NETWORK_RETRIES,
        // Расчёт списка тарифов безопасен к авто-повтору.
        idempotent: true,
      },
    );
    const list = Array.isArray(raw?.tariff_codes) ? (raw.tariff_codes as Record<string, unknown>[]) : [];
    return list.map(mapTariffOption);
  }
}

/** Доменная локация → snake_case тело СДЭК (отбрасывает undefined). */
function toApiLocation(loc: CdekLocation): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (loc.code !== undefined) out.code = loc.code;
  if (loc.postalCode !== undefined) out.postal_code = loc.postalCode;
  if (loc.address !== undefined) out.address = loc.address;
  return out;
}
