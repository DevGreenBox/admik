/**
 * POST /api/storefront/v1/delivery/cdek/calculate — расчёт стоимости/срока
 * доставки СДЭК для витрины (docs/08 §6.1, ADR-008/ADR-010).
 *
 * Конвейер runStorefront: module-gate `cdek` (404) → authorizeStorefront →
 * rate-limit → CORS. В mock-режиме СДЭК (пустые CDEK_*) — формула §5.3 без сети.
 *
 * ANTI-TAMPER (ADR-010): отправление (from_location) — ВСЕГДА серверное
 * (CDEK_FROM_LOCATION_CODE из config), из тела НЕ читается. Назначение (to) —
 * из тела. Любые поля from/from_location в теле игнорируются Zod-схемой (strip).
 * Вес/габариты позиций — ТОЖЕ серверные: резолвятся из каталога по variantId/
 * productId (приоритет вариант→товар→дефолт магазина), из тела НЕ читаются
 * (иначе клиент мог бы занизить вес и удешевить доставку). Поля weightG/… в теле
 * игнорируются схемой (strip).
 *
 * Body: { to:{ city_code?, postal_code? }, deliveryMode:'pvz'|'postamat'|'door',
 *         items:[{ variantId?, productId?, qty }], tariffCode? }.
 * Ответ: { data:{ tariffCode, cost, etaDays, periodMin, periodMax } }.
 */

import { z } from 'zod';
import {
  runStorefront,
  jsonData,
  jsonError,
  handlePreflight,
  parseJsonBody,
} from '@/lib/storefront/response';
import { STOREFRONT_WRITE_METHODS } from '@/lib/storefront/cors';
import { getCdekManager } from '@/lib/cdek/manager';
import { getCdekConfig } from '@/lib/cdek/config';
import { Calculator, type CartLineDims } from '@/lib/cdek/services/calculator';
import { resolveCartLine } from '@/lib/orders/repository';

/**
 * Нормализует клиентский tariffCode против белого списка (config.allowedTariffs):
 *   • allowedTariffs пуст → разрешены любые коды (обратная совместимость);
 *   • входной код отсутствует → defaultTariffCode (как раньше);
 *   • входной код вне whitelist → НЕ доверяем клиенту, подменяем на
 *     defaultTariffCode (defensive: расчёт не падает, но тарифом управляет сервер).
 * Дублирует политику create-flow: витрина не должна считать по произвольному
 * тарифу (ADR-010 anti-tamper, finding #4).
 */
function resolveAllowedTariff(input: number | undefined): number | undefined {
  const cfg = getCdekConfig();
  if (cfg.allowedTariffs.length === 0) return input; // whitelist выключен
  if (input === undefined) return cfg.defaultTariffCode;
  if (cfg.allowedTariffs.includes(input)) return input;
  return cfg.defaultTariffCode;
}

export const dynamic = 'force-dynamic';

// weightG/lengthCm/… НЕ описаны в схеме → strip убирает их (anti-tamper): вес
// резолвит сервер из каталога, не из тела.
//
// variantId/productId — uuid (как в orders cartLineSchema): структурно невалидный
// id = 400 на уровне схемы, чтобы мусор НЕ доходил до ::uuid-каста в БД
// (resolveCartLine) и не ронял расчёт в 500 (BUG #7, reliability). Best-effort
// (skip) сохраняется для валидных, но НЕсуществующих id — их resolveCartLine
// вернёт !ok, и позиция считается без габаритов (дефолт магазина).
const itemSchema = z.object({
  variantId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  qty: z.number().int().min(1).max(1000),
});

// from/from_location НЕ описаны в схеме → .strict()-strip убирает их (anti-tamper).
const CalculateSchema = z
  .object({
    to: z
      .object({
        city_code: z.number().int().optional(),
        postal_code: z.string().trim().max(20).optional(),
      })
      .refine((v) => v.city_code !== undefined || Boolean(v.postal_code), {
        message: 'Требуется to.city_code или to.postal_code.',
      }),
    deliveryMode: z.enum(['pvz', 'postamat', 'door']).optional(),
    items: z.array(itemSchema).min(1, 'Список позиций пуст.'),
    tariffCode: z.number().int().optional(),
  })
  .strip();

export async function POST(req: Request): Promise<Response> {
  return runStorefront(
    req,
    async ({ cors }) => {
      const body = await parseJsonBody(req);
      if (!body.ok) {
        return jsonError('bad_request', 'Тело запроса не является валидным JSON.', cors);
      }

      const parsed = CalculateSchema.safeParse(body.value);
      if (!parsed.success) {
        return jsonError(
          'bad_request',
          parsed.error.issues[0]?.message ?? 'Некорректное тело запроса.',
          cors,
        );
      }

      const { to, items, tariffCode } = parsed.data;
      // Вес/габариты позиций — СЕРВЕРНЫЕ (anti-tamper): резолвим из каталога по
      // variantId/productId (приоритет вариант→товар→дефолт магазина). Позиции, не
      // найденные/неактивные/без идентификатора → qty без габаритов (дефолт
      // магазина), расчёт не падает (best-effort, как в quoteCart).
      const lines: CartLineDims[] = await Promise.all(
        items.map(async (it): Promise<CartLineDims> => {
          if (!it.variantId && !it.productId) {
            return { qty: it.qty };
          }
          const res = await resolveCartLine({
            productId: it.productId,
            variantId: it.variantId,
            qty: it.qty,
          });
          if (!res.ok) {
            return { qty: it.qty };
          }
          return {
            qty: it.qty,
            weightG: res.line.weightG,
            lengthCm: res.line.lengthCm,
            widthCm: res.line.widthCm,
            heightCm: res.line.heightCm,
          };
        }),
      );

      // tariffCode из тела — НЕ доверяем напрямую: нормализуем по whitelist
      // (config.allowedTariffs), иначе fallback на defaultTariffCode (finding #4).
      const effectiveTariff = resolveAllowedTariff(tariffCode);

      const calc = new Calculator(getCdekManager());
      // from_location — серверный (внутри Calculator), здесь только назначение.
      const result = await calc.calculate({
        to: { code: to.city_code, postalCode: to.postal_code },
        lines,
        tariffCode: effectiveTariff,
      });

      return jsonData(
        {
          tariffCode: result.tariffCode,
          cost: result.deliverySum,
          etaDays: result.periodMin,
          periodMin: result.periodMin,
          periodMax: result.periodMax,
        },
        {},
        cors,
      );
    },
    { module: 'cdek', methods: STOREFRONT_WRITE_METHODS },
  );
}

export async function OPTIONS(req: Request): Promise<Response> {
  return handlePreflight(req, STOREFRONT_WRITE_METHODS);
}
