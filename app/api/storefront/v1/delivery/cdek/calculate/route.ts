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
 *
 * Body: { to:{ city_code?, postal_code? }, deliveryMode:'pvz'|'postamat'|'door',
 *         items:[{ variantId?, qty, weightG? }], tariffCode? }.
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
import { Calculator, type CartLineDims } from '@/lib/cdek/services/calculator';

export const dynamic = 'force-dynamic';

const itemSchema = z.object({
  variantId: z.string().optional(),
  productId: z.string().optional(),
  qty: z.number().int().min(1).max(1000),
  weightG: z.number().int().min(0).optional(),
  lengthCm: z.number().int().min(0).optional(),
  widthCm: z.number().int().min(0).optional(),
  heightCm: z.number().int().min(0).optional(),
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
      const lines: CartLineDims[] = items.map((it) => ({
        qty: it.qty,
        weightG: it.weightG ?? null,
        lengthCm: it.lengthCm ?? null,
        widthCm: it.widthCm ?? null,
        heightCm: it.heightCm ?? null,
      }));

      const calc = new Calculator(getCdekManager());
      // from_location — серверный (внутри Calculator), здесь только назначение.
      const result = await calc.calculate({
        to: { code: to.city_code, postalCode: to.postal_code },
        lines,
        tariffCode,
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
