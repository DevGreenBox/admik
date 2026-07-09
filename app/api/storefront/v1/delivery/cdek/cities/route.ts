/**
 * GET /api/storefront/v1/delivery/cdek/cities — поиск городов СДЭК для
 * автокомплита города на витрине (docs/08 §6.1, ADR-008; docs/13 §2 — гэп).
 * Прокси к СДЭК: ключи не утекают на фронт.
 *
 * Конвейер runStorefront: module-gate `cdek` (404 при выключенном) →
 * authorizeStorefront (401/403) → rate-limit (429) → CORS. В mock-режиме СДЭК
 * (пустые CDEK_*) отдаёт фикстуры без сети. Real-ветка сервиса ходит в
 * GET /v2/location/suggest/cities (подсказки по подстроке — аудит 2026-07-09).
 *
 * ОБРАБОТКА ОШИБОК СДЭК (аудит перехода в бой 2026-07-09): раньше 429/таймаут/
 * HTTP-ошибка СДЭК роняли роут в неструктурированный 500 без JSON-конверта и
 * CORS. Теперь любой CdekError → 503 { error: { code, message } } (envelope как
 * у остальных storefront-ошибок) + CORS + Retry-After.
 *
 * Query: q (подстрока имени города, ≥2 символов); опц. limit.
 * Ответ: { data: [{ code, name, region }] }. code нужен для расчёта/ПВЗ.
 */

import { NextResponse } from 'next/server';
import {
  runStorefront,
  jsonData,
  handlePreflight,
} from '@/lib/storefront/response';
import { STOREFRONT_METHODS } from '@/lib/storefront/cors';
import { getCdekManager } from '@/lib/cdek/manager';
import { CdekError } from '@/lib/cdek/errors';
import { CityService } from '@/lib/cdek/services/city';

export const dynamic = 'force-dynamic';

/**
 * Локальный конверт 503 «служба доставки недоступна» (429/сеть/5xx СДЭК).
 * В lib/storefront/response.ts нет 503-кода (jsonError маппит фиксированный
 * набор), а общий файл в этой волне не редактируется — поэтому хелпер живёт в
 * роуте. Формат — тот же envelope { error: { code, message } } + CORS.
 */
function jsonUpstreamUnavailable(cors: Record<string, string>): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'service_unavailable',
        message: 'Служба доставки временно недоступна. Повторите попытку позже.',
      },
    },
    { status: 503, headers: { ...cors, 'Retry-After': '30' } },
  );
}

export async function GET(req: Request): Promise<Response> {
  return runStorefront(
    req,
    async ({ cors }) => {
      const url = new URL(req.url);
      const q = url.searchParams.get('q') ?? '';
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(50, Math.max(1, Math.trunc(Number(limitRaw)) || 10)) : 10;

      // Короткий запрос (<2) → пустой список (без обращения к СДЭК) — сервис сам так делает.
      const cities = new CityService(getCdekManager());
      try {
        const data = await cities.searchCities(q, limit);
        return jsonData(data, {}, cors);
      } catch (err) {
        // 429/сеть/5xx СДЭК → структурированный 503 (CORS сохраняется).
        if (err instanceof CdekError) {
          return jsonUpstreamUnavailable(cors);
        }
        throw err;
      }
    },
    { module: 'cdek', methods: STOREFRONT_METHODS },
  );
}

export async function OPTIONS(req: Request): Promise<Response> {
  return handlePreflight(req, STOREFRONT_METHODS);
}
