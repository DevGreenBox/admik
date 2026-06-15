'use server';

import { z } from 'zod';

import { defineAction } from '@/lib/server/action';
import { isModuleEnabled } from '@/lib/config/modules';
import { OrderService } from './services/order';
import { TrackingService } from './services/tracking';
import { PrintService } from './services/print';
import { CdekError } from './errors';

/**
 * Server Actions модуля cdek (docs/08 §10.1).
 *
 * Все мутации — через единый пайплайн defineAction (ядро §4.7): guard
 * (cdek.manage) → Zod → handler (вызов сервиса СДЭК) → revalidate карточки
 * заказа → audit `cdek.*`. Доменные ошибки — CdekError из lib/cdek/errors.ts
 * (класс НЕ объявляется в этом 'use server'-файле, только импортируется).
 *
 * Флаг модуля: каждый handler проверяет isModuleEnabled('cdek') и отклоняет
 * вызов при выключенном модуле (помимо скрытия в UI).
 *
 * Бизнес-логика (создание/отмена/трек/печать) — внутри сервисов
 * lib/cdek/services/* через getCdekManager(); здесь только оркестрация пайплайна.
 */

// -----------------------------------------------------------------------------
// Общие хелперы.
// -----------------------------------------------------------------------------

/** Бросает, если модуль cdek выключен. */
function assertCdekEnabled(): void {
  if (!isModuleEnabled('cdek')) {
    throw new CdekError('module_disabled', 'Модуль «СДЭК» выключен.');
  }
}

/** Путь инвалидации карточки заказа. */
function orderPath(orderId: string): string {
  return `/admin/orders/${orderId}`;
}

/** Вход «только orderId» (общий для большинства действий). */
const OrderIdSchema = z.object({ orderId: z.string().uuid() });

/** Вход создания (с опц. force-перевыпуском). */
const CreateShipmentSchema = z.object({
  orderId: z.string().uuid(),
  force: z.boolean().optional(),
});

/** Вход печати (накладная по умолчанию либо ШК). */
const LabelSchema = z.object({
  orderId: z.string().uuid(),
  kind: z.enum(['waybill', 'barcode']).optional(),
});

// -----------------------------------------------------------------------------
// createCdekShipment — создание отправления (audit cdek.shipment.create).
// -----------------------------------------------------------------------------

export const createCdekShipment = defineAction({
  permission: 'cdek.manage',
  input: CreateShipmentSchema,
  handler: async ({ orderId, force }) => {
    assertCdekEnabled();
    const shipment = await new OrderService().createShipment(orderId, { force });
    return {
      result: {
        id: shipment.id,
        cdekUuid: shipment.cdekUuid,
        cdekNumber: shipment.cdekNumber,
        isMock: shipment.isMock,
      },
      revalidate: [orderPath(orderId)],
      audit: {
        action: 'cdek.shipment.create',
        entityType: 'cdek_shipment',
        entityId: shipment.id,
        after: { cdekUuid: shipment.cdekUuid, cdekNumber: shipment.cdekNumber },
      },
    };
  },
});

// -----------------------------------------------------------------------------
// cancelCdekShipment — отмена отправления (audit cdek.shipment.cancel).
// -----------------------------------------------------------------------------

export const cancelCdekShipment = defineAction({
  permission: 'cdek.manage',
  input: OrderIdSchema,
  handler: async ({ orderId }) => {
    assertCdekEnabled();
    await new OrderService().cancelShipment(orderId);
    return {
      result: { orderId, cancelled: true },
      revalidate: [orderPath(orderId)],
      audit: {
        action: 'cdek.shipment.cancel',
        entityType: 'cdek_shipment',
        entityId: orderId,
        after: { cancelled: true },
      },
    };
  },
});

// -----------------------------------------------------------------------------
// refreshCdekStatus — pull-обновление статуса (audit cdek.status.sync).
// -----------------------------------------------------------------------------

export const refreshCdekStatus = defineAction({
  permission: 'cdek.manage',
  input: OrderIdSchema,
  handler: async ({ orderId }) => {
    assertCdekEnabled();
    const res = await new TrackingService().refreshStatus(orderId);
    return {
      result: res,
      revalidate: [orderPath(orderId)],
      audit: {
        action: 'cdek.status.sync',
        entityType: 'cdek_shipment',
        entityId: orderId,
        after: {
          statusCode: res.statusCode,
          deliveryStatus: res.appliedDeliveryStatus,
          transitioned: res.transitioned,
        },
      },
    };
  },
});

// -----------------------------------------------------------------------------
// getCdekLabel — URL накладной/ШК (audit cdek.print.label).
// -----------------------------------------------------------------------------

export const getCdekLabel = defineAction({
  permission: 'cdek.manage',
  input: LabelSchema,
  handler: async ({ orderId, kind }) => {
    assertCdekEnabled();
    const { url } = await new PrintService().getShipmentLabel(orderId, { kind });
    return {
      result: { url },
      // печать не меняет данные заказа — инвалидация не нужна (URL вернётся клиенту);
      // но print_url сохраняется в shipment, поэтому обновим карточку.
      revalidate: [orderPath(orderId)],
      audit: {
        action: 'cdek.print.label',
        entityType: 'cdek_shipment',
        entityId: orderId,
        after: { kind: kind ?? 'waybill', url },
      },
    };
  },
});
