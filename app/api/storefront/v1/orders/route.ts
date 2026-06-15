/**
 * POST /api/storefront/v1/orders — создание заказа витриной (docs/07 §4.2,
 * ADR-010 anti-tamper). Конвейер: authorizeStorefront → модуль `orders` (иначе
 * 404) → rate-limit → CORS. Транзакция: ре-валидация цен/остатков ИЗ КАТАЛОГА,
 * атомарный резерв, выдача номера, снимок позиций, учёт промокода.
 *
 * Headers: Idempotency-Key (рекоменд.) — повтор не дублирует заказ.
 * Body: { items[], customer:{name,email,phone}, delivery:{type,city,address?,pvzCode?},
 *         paymentMethod, promoCode?, comment?, idempotencyKey? }
 * Ответ: { number, status, paymentStatus, grandTotal, currency, accessToken }.
 * Ошибки: нет остатка → 409; невалидная позиция/промокод → 422.
 */

import {
  runStorefront,
  jsonData,
  jsonError,
  handlePreflight,
  parseJsonBody,
} from '@/lib/storefront/response';
import { STOREFRONT_WRITE_METHODS } from '@/lib/storefront/cors';
import { CreateOrderSchema } from '@/lib/orders/schemas';
import { createOrder } from '@/lib/orders/repository';
import { toOrderCreatedDto } from '@/lib/storefront/order-dto';

export const dynamic = 'force-dynamic';

/** Client IP для orders.ip (как audit_log): первый из X-Forwarded-For / X-Real-IP. */
function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    return fwd.split(',')[0]!.trim() || null;
  }
  return req.headers.get('x-real-ip');
}

export async function POST(req: Request): Promise<Response> {
  return runStorefront(
    req,
    async ({ cors }) => {
      const body = await parseJsonBody(req);
      if (!body.ok) {
        return jsonError('bad_request', 'Тело запроса не является валидным JSON.', cors);
      }

      // Idempotency-Key: заголовок имеет приоритет над полем тела (§4.2).
      const headerKey = req.headers.get('idempotency-key')?.trim();
      const raw =
        body.value && typeof body.value === 'object'
          ? { ...(body.value as Record<string, unknown>) }
          : {};
      if (headerKey) {
        raw.idempotencyKey = headerKey;
      }

      const parsed = CreateOrderSchema.safeParse(raw);
      if (!parsed.success) {
        return jsonError(
          'bad_request',
          parsed.error.issues[0]?.message ?? 'Некорректное тело запроса.',
          cors,
        );
      }

      const result = await createOrder(parsed.data, {
        source: 'storefront',
        ip: clientIp(req),
      });

      if (!result.ok) {
        // Нет остатка → 409 conflict; невалидная позиция/промокод → 422.
        if (result.code === 'out_of_stock') {
          return jsonError('conflict', result.message, cors);
        }
        return jsonError('unprocessable', result.message, cors);
      }

      const dto = toOrderCreatedDto(result.order);
      // Повтор с тем же idempotency-ключом → 200 (заказ существует), иначе 201.
      return jsonData(dto, {}, cors, { status: result.reused ? 200 : 201 });
    },
    { module: 'orders', methods: STOREFRONT_WRITE_METHODS },
  );
}

export async function OPTIONS(req: Request): Promise<Response> {
  return handlePreflight(req, STOREFRONT_WRITE_METHODS);
}
