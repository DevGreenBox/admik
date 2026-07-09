/**
 * GET /api/storefront/v1/delivery/cdek/pvz — список ПВЗ/постаматов СДЭК для
 * витрины (docs/08 §6.1, ADR-008; боевой контракт — apidoc.cdek.ru
 * deliverypoints, аудит 2026-07-09). Прокси к СДЭК: ключи не утекают на фронт.
 *
 * Конвейер runStorefront: module-gate `cdek` (404 при выключенном) →
 * authorizeStorefront (401/403) → rate-limit (429) → CORS. В mock-режиме СДЭК
 * (пустые CDEK_*) отдаёт фикстуры без сети.
 *
 * Query:
 *   • city_code (int) ИЛИ postal_code — обязателен один из двух;
 *   • type — Zod-enum PVZ|POSTAMAT|ALL (регистрозависимый, apidoc; default ALL);
 *     ALL нормализуется в «без фильтра» (семантика дефолта СДЭК; в mock-ветке
 *     буквальный 'ALL' отфильтровал бы все фикстуры). Мусор → 400 bad_request;
 *   • country_code — опц., ISO 3166-1 alpha-2, проксируется как есть;
 *   • weight — опц., вес посылки в ГРАММАХ (целое >0; конвенция витрины, как
 *     weightG в /calculate). Сервис конвертирует в КГ-фильтры СДЭК
 *     weight_max=ceil(кг)/weight_min=floor(кг) (в apidoc weight_max офиса — в
 *     КГ). Витрина пока НЕ шлёт weight — поддержка на будущее (выбор ПВЗ,
 *     способного принять посылку по весу). Мусор → 400 bad_request.
 *
 * Ответ: { data: [{ code, name, address, location:{latitude,longitude}|null,
 *           workTime, type }] } — без внутренних полей (cityCode и пр. скрыты).
 * В real-ветке сервис отбрасывает офисы без выдачи (is_handout=false) и кеширует
 * список на 6ч (см. lib/cdek/services/pvz.ts).
 *
 * Ошибки СДЭК (сеть/таймаут/5xx/429/400 апстрима — любой CdekError) → 503
 * { error: { code:'upstream_unavailable', message } } + CORS + Retry-After.
 * Раньше исключение пролетало до Next голым 500 без JSON-конверта и CORS —
 * витрина не могла ни распарсить ошибку, ни вообще прочитать ответ кросс-домен.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  runStorefront,
  jsonData,
  jsonError,
  handlePreflight,
} from '@/lib/storefront/response';
import { STOREFRONT_METHODS } from '@/lib/storefront/cors';
import { getCdekManager } from '@/lib/cdek/manager';
import { CdekError } from '@/lib/cdek/errors';
import { PvzService } from '@/lib/cdek/services/pvz';
import type { CdekOffice } from '@/lib/cdek/types';

export const dynamic = 'force-dynamic';

/** Публичный DTO ПВЗ (без внутренних полей вроде cityCode). */
function toPvzDto(o: CdekOffice) {
  return {
    code: o.code,
    name: o.name,
    address: o.address,
    type: o.type,
    location: o.location,
    workTime: o.workTime,
  };
}

// Валидация «хвостовых» query-параметров (city_code/postal_code разобраны
// отдельно ниже — их взаимная обязательность и сообщения сохранены как были).
//   • type — строгий enum по apidoc (PVZ|POSTAMAT|ALL); раньше проксировался в
//     СДЭК без валидации (мусор доезжал до апстрима и падал там 400-ом);
//   • weight — граммы, целое >0 (z.coerce: query-параметр приходит строкой).
const TailQuerySchema = z.object({
  type: z.enum(['PVZ', 'POSTAMAT', 'ALL']).optional(),
  weight: z.coerce.number().int().positive().optional(),
});

/**
 * 503 для сбоя апстрима СДЭК — конверт того же формата, что jsonError
 * ({ error: { code, message } }), с CORS. Локальный хелпер, потому что
 * jsonError ограничен StorefrontErrorCode/STATUS_BY_CODE (без 503), а
 * lib/storefront/response.ts — вне зоны этой правки. Сообщение нейтральное:
 * внутренности CdekError (код СДЭК/URL/HTTP-статус) на витрину не утекают.
 */
function upstreamUnavailable(cors: Record<string, string>): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'upstream_unavailable',
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
      const cityCodeRaw = url.searchParams.get('city_code');
      const postalCode = url.searchParams.get('postal_code') ?? undefined;
      const countryCode = url.searchParams.get('country_code') ?? undefined;

      let cityCode: number | undefined;
      if (cityCodeRaw !== null && cityCodeRaw !== '') {
        const n = Number(cityCodeRaw);
        if (!Number.isFinite(n)) {
          return jsonError('bad_request', 'city_code должен быть числом.', cors);
        }
        cityCode = Math.trunc(n);
      }

      if (cityCode === undefined && !postalCode) {
        return jsonError(
          'bad_request',
          'Требуется city_code или postal_code.',
          cors,
        );
      }

      // Пустая строка = параметр не передан (симметрично city_code выше).
      const tail: Record<string, string> = {};
      const typeRaw = url.searchParams.get('type');
      if (typeRaw !== null && typeRaw !== '') tail.type = typeRaw;
      const weightRaw = url.searchParams.get('weight');
      if (weightRaw !== null && weightRaw !== '') tail.weight = weightRaw;

      const parsed = TailQuerySchema.safeParse(tail);
      if (!parsed.success) {
        return jsonError(
          'bad_request',
          parsed.error.issues[0]?.message ?? 'Некорректные параметры запроса.',
          cors,
        );
      }
      // ALL — дефолт СДЭК «оба типа»: не передаём фильтр дальше (см. шапку).
      const type = parsed.data.type === 'ALL' ? undefined : parsed.data.type;
      const weightGrams = parsed.data.weight;

      const pvz = new PvzService(getCdekManager());
      let offices: CdekOffice[];
      try {
        offices = await pvz.listOffices({
          cityCode,
          postalCode,
          type,
          countryCode,
          weightGrams,
        });
      } catch (err) {
        // Любой сбой СДЭК (сеть/таймаут/5xx/429/400 апстрима) — 503 в конверте.
        // Прочие исключения — программные, пробрасываются как раньше (500 Next).
        if (err instanceof CdekError) {
          console.error('[storefront/pvz] СДЭК недоступен:', err.code, err.message);
          return upstreamUnavailable(cors);
        }
        throw err;
      }

      return jsonData(offices.map(toPvzDto), {}, cors);
    },
    { module: 'cdek', methods: STOREFRONT_METHODS },
  );
}

export async function OPTIONS(req: Request): Promise<Response> {
  return handlePreflight(req, STOREFRONT_METHODS);
}
