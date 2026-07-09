/**
 * Низкоуровневый HTTP-клиент СДЭК API v2 (docs/08 §2.2 «CdekClient», порт
 * carre Client::request/doRequest; боевой контракт — аудит apidoc.cdek.ru
 * 2026-07-09).
 *
 * Зона ответственности — транспорт: один аутентифицированный запрос к СДЭК.
 *   • Базовый URL берётся из конфигурации (CdekConfig.baseUrl; testMode
 *     форсирует edu-контур — см. config.ts).
 *   • Authorization: Bearer <token> — токен из token-cache (getToken()).
 *   • Сериализация query/json, дефолтные заголовки (Accept: application/json).
 *   • Таймаут на запрос (AbortController) ПОКРЫВАЕТ и чтение тела ответа:
 *     res.text() читается до clearTimeout, зависший body-стрим обрывается
 *     тем же дедлайном (abort при чтении → сетевая ошибка).
 *   • Ретраи network/5xx/429 — ТОЛЬКО для ретраибельных запросов: метод
 *     GET/DELETE либо явный opts.idempotent === true. POST/PATCH без
 *     idempotent НЕ авторетраятся (иначе дубли реальных накладных
 *     POST /v2/orders): сеть/таймаут → 'cdek_network_error_unconfirmed'
 *     (запрос МОГ быть выполнен на стороне СДЭК — вызывающий обязан свериться,
 *     например GET /v2/orders?im_number=… перед повтором).
 *   • 429 для ретраибельных ретраится с задержкой из Retry-After (сек → мс,
 *     кап 3000мс; без заголовка — стандартные 250/500мс) в пределах
 *     maxNetworkRetries; иначе/по исчерпании → CdekError('cdek_rate_limited').
 *   • 401 → invalidate() токена + ровно один повтор со свежим токеном.
 *     Повтор отслеживается ОТДЕЛЬНЫМ флагом tokenRetried (не счётчиком сетевых
 *     попыток) и разрешён и для неидемпотентных запросов: 401 означает, что
 *     запрос НЕ был обработан СДЭК.
 *   • HTTP ≥ 400 → CdekError(code, message, { cdekErrors, httpStatus });
 *     cdekErrors собираются из top-level errors[] И requests[].errors[]
 *     (асинхронные методы заказов кладут детали именно туда).
 *
 * АРХИТЕКТУРНОЕ РЕШЕНИЕ (выбор mock vs real для пакета C).
 *
 * CdekClient — ВСЕГДА реальный (ходит в сеть). Mock-данные живут отдельно в
 * lib/cdek/mock/* и НЕ проходят через client. Сервисы пакета C выбирают источник
 * сами по флагу: `getCdekManager().isMock` (или isCdekMock()/getCdekConfig().
 * account). При isMock — берут детерминированные mock-функции; иначе — client.
 *
 * Почему так (а не «mock-клиент с тем же интерфейсом»): mock-ответы СДЭК
 * структурно проще доменных результатов сервисов (тариф/ПВЗ/uuid), а сервисы и
 * так разветвляются на mock-формулу/фикстуры. Отдельный mock-слой избавляет
 * client от веток «если mock» в каждом методе и держит транспорт чистым. В
 * mock-режиме client просто не инстанцируется (manager.client кидает ошибку при
 * обращении в mock — это баг вызывающего, а не штатный путь). См. manager.ts.
 */

import type { CdekConfig } from './config';
import { CdekError, isNetworkError, type CdekApiError } from './errors';
import {
  createTokenCache,
  getDefaultTokenStore,
  type TokenCache,
  type TokenStore,
} from './token-cache';

/** HTTP-методы, используемые против СДЭК API. */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Опции одного запроса (порт options из carre Client::request). */
export interface RequestOptions {
  /** Query-параметры (undefined-значения отбрасываются). */
  query?: Record<string, string | number | boolean | undefined>;
  /** Тело JSON (сериализуется, ставит Content-Type: application/json). */
  json?: unknown;
  /** Таймаут запроса, мс (дефолт 30000). */
  timeoutMs?: number;
  /** Сетевых ретраев для ретраибельных запросов (дефолт 2; задержки 250/500мс). */
  maxNetworkRetries?: number;
  /**
   * Явно пометить POST/PATCH идемпотентным (безопасным к авто-повтору).
   * GET/DELETE ретраибельны всегда; POST/PATCH — только с idempotent: true.
   * НЕ ставить для создания заказов (POST /v2/orders) — риск дублей накладных.
   */
  idempotent?: boolean;
}

/** Публичный интерфейс клиента (порт ICdekClient, docs/08 §2.2). */
export interface ICdekClient {
  request<T = unknown>(method: HttpMethod, path: string, opts?: RequestOptions): Promise<T>;
  getToken(): Promise<string>;
  invalidateToken(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_NETWORK_RETRIES = 2;
/** Задержки между сетевыми ретраями (мс), по индексу попытки. */
const RETRY_DELAYS_MS = [250, 500] as const;
/** Верхняя граница ожидания по Retry-After при 429 (мс). */
const MAX_RETRY_AFTER_MS = 3_000;

/** Параметры конструктора клиента. */
export interface CdekClientOptions {
  config: CdekConfig;
  /** Кеш токена. По умолчанию строится из config + дефолтного store. */
  tokenCache?: TokenCache;
  /** Хранилище токена (если tokenCache не передан). */
  tokenStore?: TokenStore;
  /** fetch для тестов (vi.fn). По умолчанию глобальный fetch. */
  fetchImpl?: typeof fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Стандартная задержка сетевого ретрая по номеру попытки (250/500мс). */
function standardDelayMs(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

/**
 * Задержка перед ретраем 429: Retry-After (секунды → мс, кап MAX_RETRY_AFTER_MS),
 * если заголовок есть и парсится неотрицательным числом; иначе стандартные
 * 250/500мс. Экспортирована для юнит-тестов.
 */
export function retryAfterDelayMs(retryAfterHeader: string | null, attempt: number): number {
  if (retryAfterHeader !== null) {
    const sec = Number(retryAfterHeader.trim());
    if (Number.isFinite(sec) && sec >= 0) {
      return Math.min(sec * 1000, MAX_RETRY_AFTER_MS);
    }
  }
  return standardDelayMs(attempt);
}

/** Результат одной HTTP-попытки: статус + прочитанное (под дедлайном) тело. */
interface RawResult {
  status: number;
  text: string;
  retryAfter: string | null;
}

/**
 * Реальный HTTP-клиент СДЭК. Ходит в сеть через fetch; в mock-режиме НЕ
 * используется (см. шапку и manager.ts).
 */
export class CdekClient implements ICdekClient {
  private readonly baseUrl: string;
  private readonly tokenCache: TokenCache;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CdekClientOptions) {
    const { config } = opts;
    if (!config.account || !config.secret) {
      throw new CdekError(
        'cdek_client_no_credentials',
        'CdekClient требует CDEK_ACCOUNT/CDEK_SECRET (в mock-режиме клиент не используется).',
      );
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;

    if (opts.tokenCache) {
      this.tokenCache = opts.tokenCache;
    } else {
      // Хранилище: переданное или дефолтное (Redis|память). Строим лениво через
      // обёртку, чтобы не разрешать промис в конструкторе.
      const lazyStore = opts.tokenStore
        ? Promise.resolve(opts.tokenStore)
        : getDefaultTokenStore();
      let realCache: TokenCache | null = null;
      const ensure = async (): Promise<TokenCache> => {
        if (!realCache) {
          const store = await lazyStore;
          realCache = createTokenCache({
            baseUrl: this.baseUrl,
            account: config.account!,
            secret: config.secret!,
            store,
            fetchImpl: this.fetchImpl,
          });
        }
        return realCache;
      };
      this.tokenCache = {
        getToken: () => ensure().then((c) => c.getToken()),
        invalidate: () => ensure().then((c) => c.invalidate()),
      };
    }
  }

  getToken(): Promise<string> {
    return this.tokenCache.getToken();
  }

  invalidateToken(): Promise<void> {
    return this.tokenCache.invalidate();
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    // Ретраибельность: идемпотентные по методу (GET/DELETE) либо явная пометка
    // idempotent: true. POST/PATCH без пометки НЕ авторетраятся (дубли заказов).
    const retryable = method === 'GET' || method === 'DELETE' || opts.idempotent === true;
    const maxRetries = opts.maxNetworkRetries ?? DEFAULT_MAX_NETWORK_RETRIES;

    let token = await this.getToken();
    /**
     * Повтор со свежим токеном при 401 — ОТДЕЛЬНЫЙ флаг, не связанный со
     * счётчиком сетевых попыток: 401 может прийти и после сетевых/5xx ретраев,
     * инвалидция обязана сработать ровно один раз в любом случае. 401-повтор
     * разрешён и для неидемпотентных запросов (401 = запрос НЕ был обработан).
     */
    let tokenRetried = false;
    /** Счётчик сетевых/5xx/429 попыток (не включает 401-повтор). */
    let attempt = 0;

    while (true) {
      let raw: RawResult;
      try {
        raw = await this.performOnce(method, path, opts, token);
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        if (retryable) {
          if (attempt < maxRetries) {
            await sleep(standardDelayMs(attempt));
            attempt += 1;
            continue;
          }
          throw new CdekError(
            'cdek_network_error',
            `CDEK network error on ${method} ${path}: ${(err as Error).message}`,
          );
        }
        // Неидемпотентный запрос: авторетрай запрещён, и мы НЕ знаем, дошёл ли
        // запрос до СДЭК (таймаут/обрыв после отправки). Вызывающий код обязан
        // свериться (например, поиском заказа по im_number) перед повтором.
        throw new CdekError(
          'cdek_network_error_unconfirmed',
          `CDEK network error on ${method} ${path}: ${(err as Error).message}. ` +
            'Запрос МОГ быть выполнен на стороне СДЭК — требуется сверка ' +
            'состояния (например, GET /v2/orders?im_number=…) перед повтором.',
        );
      }

      // 401 — сбросить токен и повторить ровно один раз со свежим (см. флаг выше).
      if (raw.status === 401 && !tokenRetried) {
        tokenRetried = true;
        await this.invalidateToken();
        token = await this.getToken();
        continue;
      }

      // 429 — rate limit: для ретраибельных ждём Retry-After (кап 3000мс) или
      // стандартную задержку, в пределах того же maxRetries; иначе — ошибка.
      if (raw.status === 429) {
        if (retryable && attempt < maxRetries) {
          await sleep(retryAfterDelayMs(raw.retryAfter, attempt));
          attempt += 1;
          continue;
        }
        throw new CdekError(
          'cdek_rate_limited',
          `CDEK rate limited (HTTP 429) on ${method} ${path}`,
          { httpStatus: 429, cdekErrors: extractCdekErrors(safeJsonParse(raw.text)) },
        );
      }

      // 5xx — ретрай как сетевую ошибку (только ретраибельные, до maxRetries).
      if (raw.status >= 500 && retryable && attempt < maxRetries) {
        await sleep(standardDelayMs(attempt));
        attempt += 1;
        continue;
      }

      return this.decode<T>(method, path, raw);
    }
  }

  /**
   * Одна HTTP-попытка под общим дедлайном: fetch И чтение тела (res.text())
   * идут до clearTimeout — abort по таймауту обрывает и зависший body-стрим
   * (AbortError из text() уходит наверх как сетевая ошибка).
   */
  private async performOnce(
    method: HttpMethod,
    path: string,
    opts: RequestOptions,
    token: string,
  ): Promise<RawResult> {
    const url = this.buildUrl(path, opts.query);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    let body: string | undefined;
    if (opts.json !== undefined && (method === 'POST' || method === 'PATCH')) {
      body = JSON.stringify(opts.json);
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const text = await res.text(); // под тем же дедлайном (см. док-коммент)
      return { status: res.status, text, retryAfter: res.headers.get('retry-after') };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Декодирование прочитанного ответа: JSON, маппинг ≥400 в CdekError. */
  private decode<T>(method: HttpMethod, path: string, raw: RawResult): T {
    let decoded: unknown = {};
    if (raw.text) {
      try {
        decoded = JSON.parse(raw.text);
      } catch {
        if (raw.status >= 400) {
          throw new CdekError(
            'cdek_http_error',
            `CDEK HTTP ${raw.status} on ${method} ${path}`,
            { httpStatus: raw.status },
          );
        }
        throw new CdekError(
          'cdek_invalid_json',
          `CDEK invalid JSON on ${method} ${path}: ${raw.text.slice(0, 500)}`,
          { httpStatus: raw.status },
        );
      }
    }

    if (raw.status >= 400) {
      throw new CdekError(
        'cdek_http_error',
        `CDEK HTTP ${raw.status} on ${method} ${path}`,
        { httpStatus: raw.status, cdekErrors: extractCdekErrors(decoded) },
      );
    }

    return decoded as T;
  }
}

/** JSON.parse без исключений (для тел ошибок 429 и т.п.). */
function safeJsonParse(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Приводит элементы массива errors[] к CdekApiError, добавляя в acc с дедупом. */
function collectErrors(
  arr: unknown,
  acc: CdekApiError[],
  seen: Set<string>,
): void {
  if (!Array.isArray(arr)) return;
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    const rec = e as Record<string, unknown>;
    const code = typeof rec.code === 'string' ? rec.code : 'unknown';
    const message = typeof rec.message === 'string' ? rec.message : '';
    const key = `${code}\u0000${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    acc.push({ code, message });
  }
}

/**
 * Достаёт structured errors из тела ответа СДЭК: объединение top-level
 * `errors[]` И всех `requests[].errors[]` (асинхронные методы заказов на
 * 400/202 кладут детали именно в requests[].errors[] — apidoc.cdek.ru,
 * «15. Асинхронность»), с дедупом по code+message. Экспортирована для сервиса
 * заказов (разбор requests[].state INVALID).
 */
export function extractCdekErrors(decoded: unknown): CdekApiError[] {
  const acc: CdekApiError[] = [];
  const seen = new Set<string>();
  if (decoded && typeof decoded === 'object') {
    const rec = decoded as Record<string, unknown>;
    collectErrors(rec.errors, acc, seen);
    if (Array.isArray(rec.requests)) {
      for (const req of rec.requests) {
        if (req && typeof req === 'object') {
          collectErrors((req as Record<string, unknown>).errors, acc, seen);
        }
      }
    }
  }
  return acc;
}
