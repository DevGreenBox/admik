/**
 * Единый формат ответов/ошибок Storefront API + общий конвейер обработки роута
 * (docs/06 §6, ADR-008). Держим здесь, чтобы 4 роута не дублировали:
 *  authorizeStorefront → 401/403; isModuleEnabled('catalog') → 404;
 *  rate-limit по ключу/ip → 429; CORS-заголовки в каждом ответе; preflight.
 *
 * Формат успеха: { data, ...meta }.  Формат ошибки: { error: { code, message } }.
 */

import { NextResponse } from 'next/server';
import { isModuleEnabled } from '@/lib/config/modules';
import {
  checkLoginRate,
  registerLoginFailure,
} from '@/lib/auth/rate-limit';
import { authorizeStorefront, extractApiKey } from './auth';
import { buildCorsHeaders, buildPreflightHeaders, isPreflight } from './cors';

/** Код ошибки Storefront API. */
export type StorefrontErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'bad_request'
  | 'module_disabled';

const STATUS_BY_CODE: Record<StorefrontErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  bad_request: 400,
  module_disabled: 404,
};

/** JSON-ответ успеха { data, ...meta } с CORS-заголовками. */
export function jsonData(
  data: unknown,
  meta: Record<string, unknown>,
  cors: Record<string, string>,
  init: { status?: number } = {},
): NextResponse {
  return NextResponse.json(
    { data, ...meta },
    { status: init.status ?? 200, headers: cors },
  );
}

/** JSON-ответ ошибки { error: { code, message } } с CORS-заголовками. */
export function jsonError(
  code: StorefrontErrorCode,
  message: string,
  cors: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status: STATUS_BY_CODE[code], headers: { ...cors, ...extraHeaders } },
  );
}

/** Контекст, переданный в обработчик после прохождения конвейера. */
export interface StorefrontContext {
  /** CORS-заголовки для ответа (origin уже разрешён). */
  cors: Record<string, string>;
  /** Нормализованный origin (если был). */
  origin?: string;
}

/** Ключ rate-limit: предпочитаем API-ключ, иначе client IP, иначе 'anon'. */
function rateKey(req: Request): string {
  const apiKey = extractApiKey(req.headers);
  if (apiKey) {
    return `storefront:key:${apiKey}`;
  }
  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : req.headers.get('x-real-ip');
  return `storefront:ip:${ip || 'anon'}`;
}

/** Обработка preflight OPTIONS — отдельная, без auth/rate-limit. */
export function handlePreflight(req: Request): NextResponse {
  const auth = authorizeStorefront(req.headers);
  if (isPreflight(req.method, req.headers)) {
    return new NextResponse(null, {
      status: 204,
      headers: buildPreflightHeaders(auth.ok ? auth.origin : null),
    });
  }
  // Обычный OPTIONS без preflight-заголовков.
  return new NextResponse(null, {
    status: 204,
    headers: buildCorsHeaders(auth.ok ? auth.origin : null),
  });
}

/**
 * Общий конвейер GET-роута Storefront API. Выполняет:
 *  1) модуль catalog включён? иначе 404;
 *  2) authorizeStorefront → 401 (нет ключа/origin) / 403 (неверные);
 *  3) rate-limit по ключу/ip → 429;
 * затем вызывает handler(ctx). Любые ошибки envelope'ятся как 500-нейтрально
 * вызывающим (handler сам решает 404 на отсутствие сущности).
 */
export async function runStorefront(
  req: Request,
  handler: (ctx: StorefrontContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  const auth = authorizeStorefront(req.headers);
  const cors = buildCorsHeaders(auth.ok ? auth.origin : null);

  // 1) Модуль каталога.
  if (!isModuleEnabled('catalog')) {
    return jsonError('module_disabled', 'Модуль каталога отключён.', cors);
  }

  // 2) Аутентификация витрины.
  if (!auth.ok) {
    // Различаем «не предъявлено» (401) и «предъявлено, но неверно» (403).
    const presented =
      extractApiKey(req.headers) !== null || req.headers.get('origin') !== null;
    if (presented) {
      return jsonError('forbidden', 'Доступ витрины запрещён.', cors);
    }
    return jsonError(
      'unauthorized',
      'Требуется API-ключ витрины или разрешённый Origin.',
      cors,
    );
  }

  // 3) Rate-limit (переиспользуем lib/auth/rate-limit).
  const key = rateKey(req);
  const rate = await checkLoginRate(key);
  if (!rate.allowed) {
    return jsonError('rate_limited', 'Слишком много запросов.', cors, {
      'Retry-After': String(rate.retryAfterSec ?? 60),
    });
  }
  // Каждый запрос — +1 к счётчику окна (fixed-window лимит на витрину/ip).
  await registerLoginFailure(key);

  return handler({ cors, origin: auth.ok ? auth.origin : undefined });
}
