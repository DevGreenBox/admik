/**
 * Смена delivery_status заказа из модуля cdek БЕЗ Server Actions (docs/08 §8.4).
 *
 * Задача: webhook/tracking/cancel должны обновлять orders.delivery_status, но не
 * дёргать lib/orders/actions (Server Actions с RBAC/контекстом). Поэтому работаем
 * напрямую через sql + статус-машину canTransition('delivery', …) из
 * lib/orders/status.ts — соблюдаем тот же whitelist переходов, что и UI/админка.
 *
 * Идемпотентность/безопасность (БАГ #8/#16, анти-TOCTOU): чтение `from`, проверка
 * перехода и запись — в ОДНОЙ транзакции. SELECT ... FOR UPDATE берёт блокировку
 * строки заказа на время транзакции, поэтому конкурентные источники (webhook СДЭК
 * + cron refresh-active + ручная смена в админке) сериализуются: второй ждёт
 * коммита первого и видит актуальный статус. Дополнительно guarded UPDATE (WHERE
 * delivery_status = from) защищает от out-of-order доставки: если к моменту UPDATE
 * статус уже изменён другим событием — затронуто 0 строк, переход пропускаем (не
 * откатываем delivered → in_transit). Эффекты (UPDATE+история) — ТОЛЬКО при count===1.
 *   • from === to или недопустимый переход → no-op (false), без записи истории;
 *   • история (kind='delivery', actor_user_id = NULL → система/СДЭК) пишется
 *     ТОЛЬКО при реально применённом переходе (affected===1).
 *
 * Это единственное «вторжение» в схему orders — параметризованным sql, как
 * указано в ТЗ пакета D (lib/orders не трогаем кроме импорта типов/функций).
 * Тот же приём, что в applyOrderStatusTransition / applyPaymentStatus.
 */

import { sql } from '@/lib/db/client';
import type { TransactionSql } from 'postgres';
import { canTransition } from '@/lib/orders/status';
import type { DeliveryStatus } from '@/lib/orders/types';

/**
 * Применяет переход delivery_status для заказа, если он допустим статус-машиной.
 * Возвращает true, если переход применён; false, если пропущен (недопустим /
 * заказ не найден / from === to). Безопасно при повторном вызове (идемпотентно).
 */
export async function applyDeliveryStatus(
  orderId: string,
  to: DeliveryStatus,
  comment = '',
): Promise<boolean> {
  return await sql.begin<boolean>(async (tx: TransactionSql) => {
    const rows = await tx<{ delivery_status: string }[]>`
      SELECT delivery_status FROM orders WHERE id = ${orderId} FOR UPDATE
    `;
    const from = rows[0]?.delivery_status as DeliveryStatus | undefined;
    if (!from) return false;
    if (from === to) return false;
    if (!canTransition('delivery', from, to)) return false;

    // GUARDED UPDATE: переход применяется ТОЛЬКО если delivery_status всё ещё равен
    // прочитанному `from` (WHERE ... AND delivery_status = from). Если 0 строк →
    // конкурентный источник уже сменил статус → переход пропускаем (no-op), история
    // НЕ пишется. Под FOR UPDATE это страховка на случай иной изоляции/реплик.
    const updated = await tx`
      UPDATE orders
         SET delivery_status = ${to}, updated_at = now()
       WHERE id = ${orderId} AND delivery_status = ${from}
    `;
    if (updated.count !== 1) return false;

    await tx`
      INSERT INTO order_status_history
        (order_id, kind, from_status, to_status, actor_user_id, comment)
      VALUES
        (${orderId}, 'delivery', ${from}, ${to}, NULL, ${comment})
    `;
    return true;
  });
}
