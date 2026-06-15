/**
 * OrderService — создание/отмена отправления СДЭК (docs/08 §7.1, порт carre
 * OrderService.php).
 *
 * Выбор источника — по manager.isMock (docs/08 §11):
 *   • mock → mockCreateShipment (фейковый uuid+трек), без сети;
 *   • real → manager.client.request POST /v2/orders.
 *
 * Идемпотентность (docs/08 §7.1): если отправление по заказу уже создано
 * (cdek_uuid выставлен) — повторно не создаём, возвращаем существующее (если не
 * передан force). Самовывоз (pickup) пропускается. Состояние заказа проверяется:
 * заказ должен быть оплачен (paymentStatus === 'paid' или status уже не new/
 * awaiting_payment) — иначе ошибка precondition.
 *
 * Чистые/тестируемые части: normalizePhone, buildPayload — без сети/БД.
 * БД-зависимые createShipment/cancelShipment — интеграционные (skipIf в тестах).
 */

import { sql } from '@/lib/db/client';
import type { CdekManager } from '../manager';
import { getCdekManager } from '../manager';
import { CdekError } from '../errors';
import {
  getShipmentByOrderId,
  createShipment as repoCreateShipment,
  updateShipmentByOrderId,
  bumpShipmentRetry,
} from '../repository';
import { getOrderById, type OrderWithItems } from '@/lib/orders/repository';
import type { Order, OrderItem } from '@/lib/orders/types';
import type {
  CdekShipment,
  CdekDeliveryMode,
  CdekPackage,
} from '../types';
import { aggregatePackage, type CartLineDims } from './calculator';

// -----------------------------------------------------------------------------
// normalizePhone — ЧИСТАЯ (порт OrderService::normalizePhone). Тестируется без сети.
// -----------------------------------------------------------------------------

/**
 * Нормализует телефон в формат +7XXXXXXXXXX (порт carre):
 *   • только цифры;
 *   • 10 цифр → префикс +7;
 *   • 11 цифр, начинается с 8 или 7 → ведущая заменяется на 7, префикс +;
 *   • иначе (< 10 / непонятный формат) → CdekError.
 */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D+/g, '');
  if (digits.length === 10) {
    return `+7${digits}`;
  }
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) {
    return `+7${digits.slice(1)}`;
  }
  throw new CdekError('cdek_invalid_phone', `Некорректный телефон получателя: "${raw}".`);
}

// -----------------------------------------------------------------------------
// Снимок отправления из заказа (вес/габариты/режим/назначение).
// -----------------------------------------------------------------------------

/** delivery_type заказа → режим доставки СДЭК. */
export function deliveryModeFor(order: Order): CdekDeliveryMode {
  switch (order.deliveryType) {
    case 'courier':
      return 'door';
    case 'pvz':
      return 'pvz';
    default:
      // pickup сюда не доходит (отсекается раньше), но для полноты — door.
      return 'door';
  }
}

/** Позиции заказа → строки для агрегации упаковки (вес/габариты — снимок). */
function linesFromItems(items: readonly OrderItem[]): CartLineDims[] {
  // У позиции заказа нет веса/габаритов (снимок каталога их не хранит) — берём
  // qty, остальное подставит дефолт магазина в aggregatePackage.
  return items.map((it) => ({ qty: it.quantity }));
}

// -----------------------------------------------------------------------------
// buildPayload — ЧИСТАЯ (порт OrderService::buildPayload). Тестируется без сети.
// -----------------------------------------------------------------------------

/** Тело запроса POST /v2/orders (snake_case как у СДЭК). */
export interface CdekOrderPayload {
  type: number;
  number: string;
  tariff_code: number;
  shipment_point?: string;
  from_location?: { code: number };
  delivery_point?: string;
  to_location?: { code?: number; postal_code?: string; address?: string };
  recipient: {
    name: string;
    phones: Array<{ number: string }>;
    email?: string;
  };
  sender?: {
    name?: string;
    company?: string;
    email?: string;
    tin?: string;
    phones?: Array<{ number: string }>;
  };
  packages: Array<{
    number: string;
    weight: number;
    length?: number;
    width?: number;
    height?: number;
    items: Array<{
      name: string;
      ware_key: string;
      payment: { value: number };
      cost: number;
      amount: number;
      weight: number;
    }>;
  }>;
}

/** Опции сборки payload (габариты по умолчанию из конфига). */
export interface BuildPayloadOptions {
  defaultDimensions: { weightG: number; lengthCm: number; widthCm: number; heightCm: number };
  fromLocationCode: number;
  shipmentPoint: string | null;
  defaultTariffCode: number;
  sender: {
    name: string | null;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    inn: string | null;
  };
}

/**
 * Собирает payload создания отправления из заказа+позиций (порт buildPayload).
 * Чистая: вход — заказ/позиции/опции; никакого I/O.
 *
 * Назначение: режим pvz/postamat → delivery_point (код ПВЗ); door → to_location
 * (код города + индекс/адрес). Отправитель: shipment_point ИЛИ from_location
 * (взаимоисключимы). packages — одна упаковка, агрегированная из позиций.
 */
export function buildPayload(
  order: Order,
  items: readonly OrderItem[],
  opts: BuildPayloadOptions,
): CdekOrderPayload {
  const mode = deliveryModeFor(order);
  const pkg: CdekPackage = aggregatePackage(linesFromItems(items), {
    weightG: opts.defaultDimensions.weightG,
    lengthCm: opts.defaultDimensions.lengthCm,
    widthCm: opts.defaultDimensions.widthCm,
    heightCm: opts.defaultDimensions.heightCm,
  });

  const payload: CdekOrderPayload = {
    type: 1,
    number: order.number,
    tariff_code: opts.defaultTariffCode,
    recipient: {
      name: order.customerName,
      phones: [{ number: normalizePhone(order.customerPhone) }],
      ...(order.customerEmail ? { email: order.customerEmail } : {}),
    },
    sender: {
      ...(opts.sender.name ? { company: opts.sender.name } : {}),
      ...(opts.sender.contactName ? { name: opts.sender.contactName } : {}),
      ...(opts.sender.email ? { email: opts.sender.email } : {}),
      ...(opts.sender.inn ? { tin: opts.sender.inn } : {}),
      ...(opts.sender.phone ? { phones: [{ number: opts.sender.phone }] } : {}),
    },
    packages: [
      {
        number: order.number,
        weight: pkg.weight,
        ...(pkg.length !== undefined ? { length: pkg.length } : {}),
        ...(pkg.width !== undefined ? { width: pkg.width } : {}),
        ...(pkg.height !== undefined ? { height: pkg.height } : {}),
        items: items.map((it) => ({
          name: it.nameSnapshot,
          ware_key: it.variantId ?? it.id,
          payment: { value: 0 },
          cost: Number(it.unitPrice),
          amount: it.quantity,
          weight: Math.max(1, Math.round(opts.defaultDimensions.weightG)),
        })),
      },
    ],
  };

  // Отправитель: shipment_point ИЛИ from_location (взаимоисключимы).
  if (opts.shipmentPoint) {
    payload.shipment_point = opts.shipmentPoint;
  } else {
    payload.from_location = { code: opts.fromLocationCode };
  }

  // Назначение.
  if (mode === 'pvz' || mode === 'postamat') {
    if (order.deliveryPvzCode) {
      payload.delivery_point = order.deliveryPvzCode;
    } else {
      throw new CdekError(
        'cdek_missing_pvz',
        `Для режима ${mode} требуется код ПВЗ (deliveryPvzCode).`,
      );
    }
  } else {
    // door: адрес получателя (код города у заказа — это название, не числовой код
    // СДЭК; адрес — основное поле для курьерской доставки).
    payload.to_location = {
      ...(order.deliveryAddress ? { address: order.deliveryAddress } : {}),
    };
  }

  return payload;
}

// -----------------------------------------------------------------------------
// Проверка состояния заказа (precondition).
// -----------------------------------------------------------------------------

/** Можно ли создавать отправление для заказа (оплачен и не самовывоз). */
export function canCreateShipment(order: Order): { ok: boolean; reason?: string } {
  if (order.deliveryType === 'pickup') {
    return { ok: false, reason: 'pickup' };
  }
  const paid =
    order.paymentStatus === 'paid' ||
    ['paid', 'packed', 'shipped', 'delivered', 'completed'].includes(order.status);
  if (!paid) {
    return { ok: false, reason: 'not_paid' };
  }
  return { ok: true };
}

// -----------------------------------------------------------------------------
// OrderService.
// -----------------------------------------------------------------------------

/** Результат создания отправления в СДЭК (real). */
interface CdekCreateRaw {
  entity?: { uuid?: string };
  requests?: unknown;
}

export class OrderService {
  constructor(private readonly manager: CdekManager = getCdekManager()) {}

  /** Низкоуровневое создание в СДЭК: POST /v2/orders → uuid. */
  async create(payload: CdekOrderPayload): Promise<{ uuid: string }> {
    const raw = await this.manager.client.request<CdekCreateRaw>('POST', '/v2/orders', {
      json: payload,
    });
    const uuid = raw?.entity?.uuid;
    if (!uuid) {
      throw new CdekError('cdek_create_no_uuid', 'СДЭК не вернул uuid отправления.');
    }
    return { uuid };
  }

  /** Низкоуровневая отмена: DELETE до приёмки, PATCH после (порт cancel). */
  async cancel(uuid: string, afterAcceptance = false): Promise<void> {
    if (afterAcceptance) {
      await this.manager.client.request('PATCH', `/v2/orders/${uuid}`, { json: {} });
    } else {
      await this.manager.client.request('DELETE', `/v2/orders/${uuid}`);
    }
  }

  /**
   * Оркестратор создания отправления для заказа (docs/08 §7.1). Идемпотентен:
   *   • уже есть отправление с cdek_uuid → возвращаем его (без force);
   *   • pickup / неоплачен → ошибка precondition;
   *   • mock → фейковый uuid/трек; real → POST /v2/orders.
   * Сохраняет cdek_shipments + денормализует orders.cdek_uuid/cdek_track.
   */
  async createShipment(
    orderId: string,
    opts: { force?: boolean } = {},
  ): Promise<CdekShipment> {
    const existing = await getShipmentByOrderId(orderId);
    if (existing?.cdekUuid && !opts.force) {
      return existing; // идемпотентность: уже создано
    }

    const loaded: OrderWithItems | null = await getOrderById(orderId);
    if (!loaded) {
      throw new CdekError('cdek_order_not_found', `Заказ ${orderId} не найден.`);
    }
    const { order, items } = loaded;

    const precond = canCreateShipment(order);
    if (!precond.ok) {
      throw new CdekError(
        'cdek_precondition_failed',
        `Нельзя создать отправление для заказа ${order.number}: ${precond.reason}.`,
      );
    }

    const cfg = this.manager.config;
    const mode = deliveryModeFor(order);
    const pkg = aggregatePackage(linesFromItems(items), cfg.defaultDimensions);

    try {
      let cdekUuid: string;
      let cdekNumber: string | null;
      let isMock: boolean;

      if (this.manager.isMock) {
        const r = this.manager.mock.mockCreateShipment();
        cdekUuid = r.cdekUuid;
        cdekNumber = r.cdekNumber;
        isMock = true;
      } else {
        const payload = buildPayload(order, items, {
          defaultDimensions: cfg.defaultDimensions,
          fromLocationCode: cfg.fromLocationCode,
          shipmentPoint: cfg.shipmentPoint,
          defaultTariffCode: cfg.defaultTariffCode,
          sender: cfg.sender,
        });
        const created = await this.create(payload);
        cdekUuid = created.uuid;
        cdekNumber = null; // трек придёт позже (webhook/tracking)
        isMock = false;
      }

      const shipmentFields = {
        cdekUuid,
        cdekNumber,
        tariffCode: order.deliveryType === 'pickup' ? null : cfg.defaultTariffCode,
        pvzCode: order.deliveryPvzCode,
        deliveryMode: mode,
        weightG: pkg.weight,
        lengthCm: pkg.length ?? null,
        widthCm: pkg.width ?? null,
        heightCm: pkg.height ?? null,
        isMock,
        error: null,
      };

      const saved = existing
        ? await updateShipmentByOrderId(orderId, shipmentFields)
        : await repoCreateShipment({ orderId, ...shipmentFields });

      // Денормализация на orders (горячие поля для списков/витрины).
      await sql`
        UPDATE orders
           SET cdek_uuid = ${cdekUuid},
               cdek_track = ${cdekNumber},
               updated_at = now()
         WHERE id = ${orderId}
      `;

      return saved!;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (existing) {
        await bumpShipmentRetry(orderId, msg);
      } else {
        await repoCreateShipment({ orderId, error: msg, deliveryMode: mode });
        await bumpShipmentRetry(orderId, msg);
      }
      throw err;
    }
  }

  /**
   * Отмена отправления заказа (docs/08 §7.1). Real: DELETE/PATCH в СДЭК; mock:
   * только пометка. Обновляет статус отправления и delivery_status заказа.
   */
  async cancelShipment(
    orderId: string,
    opts: { afterAcceptance?: boolean } = {},
  ): Promise<void> {
    const shipment = await getShipmentByOrderId(orderId);
    if (!shipment?.cdekUuid) {
      throw new CdekError(
        'cdek_no_shipment',
        `Для заказа ${orderId} нет отправления для отмены.`,
      );
    }

    if (!this.manager.isMock) {
      await this.cancel(shipment.cdekUuid, opts.afterAcceptance);
    }

    await updateShipmentByOrderId(orderId, {
      statusCode: 'CANCELLED',
      statusName: 'Отменён',
      statusAt: new Date(),
    });

    // delivery_status заказа → cancelled, если переход допустим.
    await applyDeliveryStatus(orderId, 'cancelled');
  }
}

// -----------------------------------------------------------------------------
// Общий хелпер смены delivery_status (через статус-машину, без Server Actions).
// Реэкспортируется из tracking.ts/webhook.ts через общий модуль.
// -----------------------------------------------------------------------------

import { applyDeliveryStatus } from './delivery-status';
