'use server';

import {
  createCdekShipment,
  cancelCdekShipment,
  refreshCdekStatus,
} from '@/lib/cdek/actions';
import type { ActionResult } from '@/lib/server/action';

/**
 * Тонкие серверные обёртки над Server Actions модуля cdek (lib/cdek/actions).
 *
 * Дают клиентскому компоненту CdekBlock ('use client') стабильные серверные
 * функции для импорта. Бизнес-логика, guard (cdek.manage), Zod, аудит и
 * инвалидация — внутри defineAction в lib/cdek/actions; здесь только проксирование
 * (паттерн orders/_components/order-actions.ts).
 *
 * Печать НЕ проксируется (гэп №3 боевого аудита 2026-07-09): PDF отдаёт
 * авторизованный серверный route /admin/cdek/label (см. lib/cdek/print-label
 * labelProxyUrl) — прямой URL api.cdek.ru требует Bearer и живёт ~1 час.
 */

export async function createCdekShipmentAction(
  input: unknown,
): Promise<ActionResult<{ id: string; cdekUuid: string | null; cdekNumber: string | null; isMock: boolean }>> {
  return createCdekShipment(input) as Promise<
    ActionResult<{ id: string; cdekUuid: string | null; cdekNumber: string | null; isMock: boolean }>
  >;
}

export async function cancelCdekShipmentAction(input: unknown): Promise<ActionResult<unknown>> {
  return cancelCdekShipment(input);
}

export async function refreshCdekStatusAction(input: unknown): Promise<ActionResult<unknown>> {
  return refreshCdekStatus(input);
}
