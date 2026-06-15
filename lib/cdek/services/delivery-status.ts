/**
 * Смена delivery_status заказа из модуля cdek БЕЗ Server Actions (docs/08 §8.4).
 *
 * Задача: webhook/tracking/cancel должны обновлять orders.delivery_status, но не
 * дёргать lib/orders/actions (Server Actions с RBAC/контекстом). Поэтому работаем
 * напрямую через sql + статус-машину canTransition('delivery', …) из
 * lib/orders/status.ts — соблюдаем тот же whitelist переходов, что и UI/админка.
 *
 * Идемпотентность/безопасность:
 *   • from === to или недопустимый переход → no-op (false), без записи истории;
 *   • переход в транзакции: UPDATE orders + INSERT order_status_history (kind=
 *     'delivery', actor_user_id = NULL → система/СДЭК).
 *
 * Это единственное «вторжение» в схему orders — параметризованным sql, как
 * указано в ТЗ пакета D (lib/orders не трогаем кроме импорта типов/функций).
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
  const rows = await sql<{ delivery_status: string }[]>`
    SELECT delivery_status FROM orders WHERE id = ${orderId} LIMIT 1
  `;
  const from = rows[0]?.delivery_status as DeliveryStatus | undefined;
  if (!from) return false;
  if (from === to) return false;
  if (!canTransition('delivery', from, to)) return false;

  await sql.begin(async (tx: TransactionSql) => {
    await tx`
      UPDATE orders
         SET delivery_status = ${to}, updated_at = now()
       WHERE id = ${orderId}
    `;
    await tx`
      INSERT INTO order_status_history
        (order_id, kind, from_status, to_status, actor_user_id, comment)
      VALUES
        (${orderId}, 'delivery', ${from}, ${to}, NULL, ${comment})
    `;
  });

  return true;
}
