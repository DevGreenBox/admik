/**
 * Репозиторий модуля payments/tbank (docs/15 §4.2, §4.4, порт lib/cdek/repository
 * + delivery-status). БД-зависимый слой:
 *   • insertPaymentLog — идемпотентная запись события webhook (ON CONFLICT DO
 *     NOTHING по UNIQUE (payment_id, status)); дубликат → inserted=false;
 *   • markPaymentLogProcessed — пометить событие обработанным;
 *   • applyPaymentStatus — смена orders.payment_status через статус-машину
 *     canTransition('payment', …) в транзакции (UPDATE orders + INSERT history),
 *     БЕЗ Server Actions (webhook не имеет RBAC-контекста), как applyDeliveryStatus;
 *   • setPaymentRefAndProvider — сохранить PaymentId/провайдера на заказе после Init.
 *
 * Идемпотентность/безопасность: переход применяется лишь если допустим (from→to);
 * from===to / недопустимый / заказ не найден → no-op (false). Повторный вызов
 * безопасен. paid проставляет paid_at (§2.8 B), как setPaymentStatus в actions.
 */

import { sql } from '@/lib/db/client';
import type { TransactionSql } from 'postgres';
import { canTransition } from '@/lib/orders/status';
import type { PaymentStatus } from '@/lib/orders/types';

// -----------------------------------------------------------------------------
// Лог webhook (идемпотентность).
// -----------------------------------------------------------------------------

/** Поля для записи события в tbank_payment_log (идемпотентная вставка). */
export interface PaymentLogInput {
  orderId: string;
  paymentId: string;
  status: string;
  amountKop?: number | null;
  isMock?: boolean;
  rawPayload?: Record<string, unknown> | null;
  ip?: string | null;
}

/** Результат идемпотентной вставки: inserted=true → новое событие; false → дубликат. */
export interface PaymentLogResult {
  inserted: boolean;
  id: string | null;
}

/**
 * Идемпотентно пишет событие webhook (docs/15 §4.2). UNIQUE (payment_id, status);
 * дубликат (повторная доставка) → inserted=false (переход не повторяем).
 */
export async function insertPaymentLog(input: PaymentLogInput): Promise<PaymentLogResult> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO tbank_payment_log (
      order_id, payment_id, status, amount_kop, is_mock, raw_payload, ip
    ) VALUES (
      ${input.orderId}, ${input.paymentId}, ${input.status},
      ${input.amountKop ?? null}, ${input.isMock ?? false},
      ${input.rawPayload ? sql.json(input.rawPayload as Record<string, never>) : null},
      ${input.ip ?? null}
    )
    ON CONFLICT (payment_id, status) DO NOTHING
    RETURNING id
  `;
  const id = rows[0]?.id ?? null;
  return { inserted: id !== null, id };
}

/** Помечает запись лога обработанной (переход payment_status применён). */
export async function markPaymentLogProcessed(id: string): Promise<void> {
  await sql`UPDATE tbank_payment_log SET processed = true WHERE id = ${id}`;
}

// -----------------------------------------------------------------------------
// Смена payment_status (без Server Actions) — порт applyDeliveryStatus.
// -----------------------------------------------------------------------------

/**
 * Применяет переход payment_status заказа, если он допустим статус-машиной
 * canTransition('payment', …). Возвращает true, если применён; false — пропущен
 * (недопустим / заказ не найден / from===to). Идемпотентно при повторном вызове.
 * paid проставляет paid_at (§2.8 B). Транзакция: UPDATE orders + INSERT history
 * (kind='payment', actor_user_id=NULL → система/Т-Банк).
 */
export async function applyPaymentStatus(
  orderId: string,
  to: PaymentStatus,
  comment = '',
): Promise<boolean> {
  // АТОМАРНОСТЬ (анти-TOCTOU): чтение `from`, проверка перехода и запись — в ОДНОЙ
  // транзакции. SELECT ... FOR UPDATE берёт блокировку строки заказа на время
  // транзакции, так что конкурентный webhook ждёт коммита и видит уже актуальный
  // статус. Дополнительно guarded UPDATE (WHERE payment_status = from) защищает
  // от out-of-order доставки: если к моменту UPDATE статус уже изменён другим
  // событием — затронуто 0 строк, переход пропускаем (не откатываем paid→…).
  // Эффекты (paid_at, история) применяются ТОЛЬКО при rowCount === 1.
  return await sql.begin<boolean>(async (tx: TransactionSql) => {
    const rows = await tx<{ payment_status: string }[]>`
      SELECT payment_status FROM orders WHERE id = ${orderId} FOR UPDATE
    `;
    const from = rows[0]?.payment_status as PaymentStatus | undefined;
    if (!from) return false;
    if (from === to) return false;
    if (!canTransition('payment', from, to)) return false;

    const updated =
      to === 'paid'
        ? await tx`
            UPDATE orders
               SET payment_status = ${to}, paid_at = now(), updated_at = now()
             WHERE id = ${orderId} AND payment_status = ${from}
          `
        : await tx`
            UPDATE orders
               SET payment_status = ${to}, updated_at = now()
             WHERE id = ${orderId} AND payment_status = ${from}
          `;

    // Гонка: статус успел измениться между SELECT и UPDATE (теоретически невозможно
    // под FOR UPDATE в одной транзакции, но guarded UPDATE — дешёвая страховка
    // на случай иной изоляции/реплик). 0 строк → эффект не применяем.
    if (updated.count !== 1) return false;

    await tx`
      INSERT INTO order_status_history
        (order_id, kind, from_status, to_status, actor_user_id, comment)
      VALUES
        (${orderId}, 'payment', ${from}, ${to}, NULL, ${comment})
    `;
    return true;
  });
}

/**
 * Сохраняет PaymentId Т-Банка (orders.payment_ref) и провайдера
 * (orders.payment_provider='tbank') после успешного Init. Идемпотентно
 * (перезапись теми же значениями безопасна). Не меняет payment_status.
 */
export async function setPaymentRefAndProvider(
  orderId: string,
  paymentId: string,
): Promise<void> {
  await sql`
    UPDATE orders
       SET payment_ref = ${paymentId},
           payment_provider = 'tbank',
           updated_at = now()
     WHERE id = ${orderId}
  `;
}
