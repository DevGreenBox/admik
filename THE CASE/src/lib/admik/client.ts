/**
 * Клиент Storefront API Admik. Единая точка обращения витрины к бэкенду.
 *
 * - База: `ADMIK_API_URL` (сервер) / `NEXT_PUBLIC_ADMIK_API_URL` (клиент).
 * - Ключ витрины: `STOREFRONT_API_KEY` → заголовок `X-Storefront-Key` (если задан;
 *   иначе доступ по Origin-allowlist на стороне Admik, либо mock-режим demo).
 * - Конверт ответа Admik: успех `{ data, ...meta }`, ошибка `{ error:{code,message} }`.
 *
 * См. docs/13-сращивание-the-case.md (§5, §6).
 */

import type {
  AdmikCategoryDto,
  AdmikCdekCalcDto,
  AdmikCdekCityDto,
  AdmikCdekPvzDto,
  AdmikCreateOrderInput,
  AdmikDeliveryType,
  AdmikOrderCreatedDto,
  AdmikOrderPublicDto,
  AdmikPaymentMethod,
  AdmikProductDetailDto,
  AdmikProductListItemDto,
  AdmikPageDto,
  AdmikQuoteDto,
  AdmikQuoteInput,
  AdmikSettingsDto,
} from './types';

export interface AdmikClientConfig {
  baseUrl: string;
  apiKey: string | null;
}

/** Ошибка обращения к Storefront API (несёт HTTP-статус и код ошибки Admik). */
export class AdmikApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'AdmikApiError';
    this.status = status;
    this.code = code;
  }
}

function resolveConfig(cfg?: Partial<AdmikClientConfig>): AdmikClientConfig {
  const rawBase =
    cfg?.baseUrl ??
    process.env.ADMIK_API_URL ??
    process.env.NEXT_PUBLIC_ADMIK_API_URL ??
    '';
  const baseUrl = rawBase.replace(/\/+$/, '');
  // БЕЗОПАСНОСТЬ: ключ витрины берём ТОЛЬКО из серверной переменной STOREFRONT_API_KEY.
  // НИКАКОГО NEXT_PUBLIC_* для ключа — иначе секрет вшился бы в клиентский бандл и
  // утёк бы в браузер. Server-side запросы (внутри docker-сети) шлют ключ; браузерные
  // запросы ключа НЕ имеют и авторизуются на стороне Admik по Origin (allowlist).
  const apiKey = cfg?.apiKey ?? process.env.STOREFRONT_API_KEY ?? null;
  return { baseUrl, apiKey };
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Доп. заголовки (напр. Idempotency-Key). */
  headers?: Record<string, string>;
  /** Кэширование fetch (Next.js): по умолчанию no-store для динамики. */
  cache?: RequestCache;
  /** Тег ревалидации Next (опц.). */
  next?: { revalidate?: number; tags?: string[] };
  config?: Partial<AdmikClientConfig>;
}

/** Низкоуровневый запрос: добавляет ключ/заголовки, разворачивает конверт. */
async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { baseUrl, apiKey } = resolveConfig(opts.config);
  if (!baseUrl) {
    throw new AdmikApiError(
      'Не задан ADMIK_API_URL / NEXT_PUBLIC_ADMIK_API_URL.',
      0,
    );
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...opts.headers,
  };
  if (apiKey) headers['X-Storefront-Key'] = apiKey;
  if (opts.body !== undefined && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const init: RequestInit & { next?: RequestOptions['next'] } = {
    method: opts.method ?? 'GET',
    headers,
    cache: opts.cache ?? (opts.next ? undefined : 'no-store'),
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  if (opts.next) init.next = opts.next;

  const res = await fetch(`${baseUrl}/api/storefront/v1${path}`, init);

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new AdmikApiError(
      err?.message ?? `Storefront API ${res.status}`,
      res.status,
      err?.code ?? null,
    );
  }

  return (json as { data?: T } | null)?.data as T;
}

// ---------------------------------------------------------------------------
// Перекодировки витрина → Admik.
// ---------------------------------------------------------------------------

const PAYMENT_ALIASES: Record<string, AdmikPaymentMethod> = {
  'cdek-pay': 'cdek_pay',
  cdek_pay: 'cdek_pay',
  card: 'card',
  sbp: 'sbp',
  cod: 'cod',
  invoice: 'invoice',
};

/** Способ оплаты витрины → enum Admik (неизвестный → 'unset'). */
export function mapPaymentMethod(method: string): AdmikPaymentMethod {
  return PAYMENT_ALIASES[method.toLowerCase()] ?? 'unset';
}

const DELIVERY_ALIASES: Record<string, AdmikDeliveryType> = {
  pvz: 'pvz',
  pickup: 'pickup',
  courier: 'courier',
  door: 'courier',
};

/** Тип доставки витрины → enum Admik (неизвестный → 'pvz'). */
export function mapDeliveryType(type: string): AdmikDeliveryType {
  return DELIVERY_ALIASES[type.toLowerCase()] ?? 'pvz';
}

// ---------------------------------------------------------------------------
// Каталог.
// ---------------------------------------------------------------------------

export interface ListProductsParams {
  q?: string;
  /** Серверный фасет по slug категории (Admik резолвит slug→id; docs/13 §3.5). */
  category?: string;
  categoryId?: string;
  brandId?: string;
  featured?: boolean;
  isNew?: boolean;
  sale?: boolean;
  limit?: number;
  offset?: number;
}

function bool(v: boolean | undefined): string | undefined {
  return v === undefined ? undefined : v ? '1' : '0';
}

export async function listProducts(
  params: ListProductsParams = {},
  config?: Partial<AdmikClientConfig>,
): Promise<AdmikProductListItemDto[]> {
  const qs = new URLSearchParams();
  const set = (k: string, v: string | undefined) => {
    if (v !== undefined && v !== '') qs.set(k, v);
  };
  set('q', params.q);
  set('category', params.category);
  set('categoryId', params.categoryId);
  set('brandId', params.brandId);
  set('featured', bool(params.featured));
  set('new', bool(params.isNew));
  set('sale', bool(params.sale));
  set('limit', params.limit?.toString());
  set('offset', params.offset?.toString());
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<AdmikProductListItemDto[]>(`/products${suffix}`, { config });
}

/** Карточка товара по slug. Возвращает null при 404. */
export async function getProduct(
  slug: string,
  config?: Partial<AdmikClientConfig>,
): Promise<AdmikProductDetailDto | null> {
  try {
    return await request<AdmikProductDetailDto>(
      `/products/${encodeURIComponent(slug)}`,
      { config },
    );
  } catch (e) {
    if (e instanceof AdmikApiError && e.status === 404) return null;
    throw e;
  }
}

export async function getCategories(
  config?: Partial<AdmikClientConfig>,
): Promise<AdmikCategoryDto[]> {
  return request<AdmikCategoryDto[]>('/categories', { config });
}

// ---------------------------------------------------------------------------
// Настройки магазина (брендинг / контакты / SEO / контент главной). G-01.
// ---------------------------------------------------------------------------

/**
 * Публичные настройки магазина (GET /settings). core-always-on на стороне Admik
 * (отдаётся независимо от ADMIK_MODULES). Возвращает брендинг/контакты/реквизиты/
 * SEO/контент главной; приватные поля (банковские реквизиты, og-ключ) скрыты DTO.
 */
export async function getSettings(
  config?: Partial<AdmikClientConfig>,
): Promise<AdmikSettingsDto> {
  return request<AdmikSettingsDto>('/settings', { config });
}

// ---------------------------------------------------------------------------
// CMS-страницы (G-13). Гейт module:'cms' на стороне Admik — если модуль выключен
// или страницы нет, отдаётся ошибка; клиент трактует любую ошибку как null
// (CMS опциональна: страница падает на статический фолбэк витрины).
// ---------------------------------------------------------------------------

/** Опубликованная CMS-страница по slug. null при 404 / выключенном модуле / ошибке. */
export async function getPage(
  slug: string,
  config?: Partial<AdmikClientConfig>,
): Promise<AdmikPageDto | null> {
  try {
    return await request<AdmikPageDto>(`/pages/${encodeURIComponent(slug)}`, { config });
  } catch (e) {
    if (e instanceof AdmikApiError) return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Заявки с витрины (форма обратной связи). G-09.
// ---------------------------------------------------------------------------

/** Отправляет заявку с формы /contacts (POST /leads). Бросает AdmikApiError при сбое. */
export async function submitLead(
  input: { name: string; contact: string; message: string },
  config?: Partial<AdmikClientConfig>,
): Promise<{ id: string }> {
  return request<{ id: string }>('/leads', { method: 'POST', body: input, config });
}

// ---------------------------------------------------------------------------
// Корзина / заказ.
// ---------------------------------------------------------------------------

export async function quoteCart(
  input: AdmikQuoteInput,
  config?: Partial<AdmikClientConfig>,
): Promise<AdmikQuoteDto> {
  return request<AdmikQuoteDto>('/cart/quote', {
    method: 'POST',
    body: input,
    config,
  });
}

export async function createOrder(
  input: AdmikCreateOrderInput,
  opts: { idempotencyKey?: string; config?: Partial<AdmikClientConfig> } = {},
): Promise<AdmikOrderCreatedDto> {
  const headers: Record<string, string> = {};
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  return request<AdmikOrderCreatedDto>('/orders', {
    method: 'POST',
    body: input,
    headers,
    config: opts.config,
  });
}

/** Результат инициации онлайн-оплаты Т-Банк (PaymentURL — куда вести браузер). */
export interface AdmikPaymentInitDto {
  paymentUrl: string;
  paymentId: string;
  status: string;
  isMock: boolean;
}

/**
 * Инициация онлайн-оплаты заказа (POST /payments/tbank/init). Сумму считает СЕРВЕР
 * (anti-tamper), доступ к заказу — по token заказа ИЛИ email покупателя. Возвращает
 * PaymentURL платёжного шлюза (боевой Т-Банк) либо demo-страницы (mock-режим).
 * `returnUrl` (опц.) — куда вернуть покупателя после demo-оплаты.
 */
export async function initPayment(
  orderNumber: string,
  proof: { accessToken?: string; email?: string; returnUrl?: string },
  config?: Partial<AdmikClientConfig>,
): Promise<AdmikPaymentInitDto> {
  return request<AdmikPaymentInitDto>('/payments/tbank/init', {
    method: 'POST',
    body: {
      orderNumber,
      accessToken: proof.accessToken,
      email: proof.email,
      returnUrl: proof.returnUrl,
    },
    config,
  });
}

/**
 * Трекинг/ЛК: GET /orders/{number}?token=…|email=… (анти-перебор номеров).
 * Подтверждение — токен заказа (выдаётся при создании) или email покупателя.
 * Возвращает null при 404 (нет заказа или не подтверждён доступ).
 */
export async function getOrder(
  number: string,
  proof: { token?: string; email?: string },
  config?: Partial<AdmikClientConfig>,
): Promise<AdmikOrderPublicDto | null> {
  const qs = new URLSearchParams();
  if (proof.token) qs.set('token', proof.token);
  if (proof.email) qs.set('email', proof.email);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  try {
    return await request<AdmikOrderPublicDto>(
      `/orders/${encodeURIComponent(number)}${suffix}`,
      { config },
    );
  } catch (e) {
    if (e instanceof AdmikApiError && e.status === 404) return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// СДЭК.
// ---------------------------------------------------------------------------

/** Поиск города СДЭК по названию (эндпоинт добавляется в Admik — Wave C). */
export async function cdekCities(
  query: string,
  config?: Partial<AdmikClientConfig>,
): Promise<AdmikCdekCityDto[]> {
  const qs = new URLSearchParams({ q: query });
  return request<AdmikCdekCityDto[]>(`/delivery/cdek/cities?${qs.toString()}`, {
    config,
  });
}

export async function cdekPvz(
  params: { cityCode?: number; postalCode?: string; type?: string },
  config?: Partial<AdmikClientConfig>,
): Promise<AdmikCdekPvzDto[]> {
  const qs = new URLSearchParams();
  if (params.cityCode !== undefined) qs.set('city_code', String(params.cityCode));
  if (params.postalCode) qs.set('postal_code', params.postalCode);
  if (params.type) qs.set('type', params.type);
  return request<AdmikCdekPvzDto[]>(`/delivery/cdek/pvz?${qs.toString()}`, {
    config,
  });
}

export async function cdekCalculate(
  input: {
    to: { city_code?: number; postal_code?: string };
    deliveryMode?: 'pvz' | 'postamat' | 'door';
    items: Array<{ variantId?: string; productId?: string; qty: number; weightG?: number }>;
    tariffCode?: number;
  },
  config?: Partial<AdmikClientConfig>,
): Promise<AdmikCdekCalcDto> {
  return request<AdmikCdekCalcDto>('/delivery/cdek/calculate', {
    method: 'POST',
    body: input,
    config,
  });
}
