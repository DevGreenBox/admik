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
import type { TransactionSql } from 'postgres';
import type { CdekManager } from '../manager';
import { getCdekManager } from '../manager';
import { CdekError } from '../errors';
import { extractCdekErrors } from '../client';
import {
  getShipmentByOrderId,
  createShipment as repoCreateShipment,
  updateShipmentByOrderId,
  bumpShipmentRetry,
} from '../repository';
import { getOrderById, type OrderWithItems } from '@/lib/orders/repository';
import { tariffForMode } from '../config';
import { canTransitionDelivery } from '@/lib/orders/status';
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

/**
 * Позиции заказа → строки для агрегации упаковки. Вес/габариты берутся из СНИМКА
 * заказа (order_items, 0026), который при createOrder резолвится приоритетом
 * вариант→товар из каталога (resolveLineDims). NULL-поля → дефолт магазина
 * (CDEK_DEFAULT_*) подставит aggregatePackage. Так СДЭК использует РЕАЛЬНЫЕ
 * габариты позиции, а не только дефолт.
 */
function linesFromItems(items: readonly OrderItem[]): CartLineDims[] {
  return items.map((it) => ({
    qty: it.quantity,
    weightG: it.weightG ?? null,
    lengthCm: it.lengthCm ?? null,
    widthCm: it.widthCm ?? null,
    heightCm: it.heightCm ?? null,
  }));
}

/**
 * Вес ОДНОЙ единицы позиции для item-уровня payload СДЭК (граммы, ≥ 1).
 * Приоритет: снимок позиции (вес единицы) → дефолт магазина. Целое (округление).
 */
function itemUnitWeight(item: OrderItem, defaultWeightG: number): number {
  const w = item.weightG ?? defaultWeightG;
  return Math.max(1, Math.round(w));
}

// -----------------------------------------------------------------------------
// buildWareKey — ЧИСТАЯ (фикс 1, аудит 2026-07-09). Лимит ware_key string(20).
// -----------------------------------------------------------------------------

/** Документированный лимит packages[].items[].ware_key (apidoc.cdek.ru): string(20). */
export const WARE_KEY_MAX_LENGTH = 20;

/**
 * Артикул позиции для СДЭК (ware_key, string(20)). Раньше уходил UUID варианта
 * (36 символов) — боевая регистрация падала на документированном лимите.
 *
 * Базово — SKU-снимок позиции (trim, обрезка до 20); пустой SKU → UUID позиции
 * без дефисов, первые 20. Уникальность ВНУТРИ packages[].items[] гарантирует
 * набор `used`: коллизия после обрезки получает суффикс -2/-3/… с обрезкой базы
 * так, чтобы итог не превышал 20 символов. Чистая, тестируется без сети/БД.
 */
export function buildWareKey(
  item: Pick<OrderItem, 'skuSnapshot' | 'id'>,
  used: Set<string> = new Set(),
): string {
  const sku = (item.skuSnapshot ?? '').trim();
  const base =
    sku.length > 0
      ? sku.slice(0, WARE_KEY_MAX_LENGTH)
      : item.id.replace(/-/g, '').slice(0, WARE_KEY_MAX_LENGTH);

  let key = base;
  for (let n = 2; used.has(key); n += 1) {
    const suffix = `-${n}`;
    key = base.slice(0, WARE_KEY_MAX_LENGTH - suffix.length) + suffix;
  }
  used.add(key);
  return key;
}

// -----------------------------------------------------------------------------
// Первое плечо тарифа (фикс 3): откуда СДЭК забирает груз — склад или дверь.
// -----------------------------------------------------------------------------

/**
 * Первое плечо («от склада» / «от двери») по коду тарифа.
 *
 * Источник: Приложение 4 apidoc.cdek.ru («Коды тарифов», сверено 2026-07-09):
 *   136 склад-склад, 137 склад-дверь, 233 экономичная посылка склад-склад,
 *   234 экономичная посылка склад-дверь, 368 склад-постамат — «от склада»;
 *   138 дверь-склад, 139 дверь-дверь, 366 дверь-постамат — «от двери».
 *
 * По документации: для тарифов «от склада» ОБЯЗАТЕЛЕН shipment_point (код ПВЗ
 * самопривоза) и он несовместим с from_location (v2_shipment_address_multivalued);
 * для тарифов «от двери» обязателен from_location с address.
 */
export const FIRST_LEG_BY_TARIFF: Readonly<Record<number, 'warehouse' | 'door'>> = {
  136: 'warehouse',
  137: 'warehouse',
  138: 'door',
  139: 'door',
  233: 'warehouse',
  234: 'warehouse',
  366: 'door',
  368: 'warehouse',
};

/**
 * Первое плечо тарифа; неизвестный код → 'warehouse' (безопасный дефолт для ИМ:
 * магазины сдают посылки на ПВЗ, а ошибка «не задан shipment_point» видна
 * оператору сразу и понятно, тогда как молчаливый from_location без address —
 * документированно запрещённая комбинация).
 */
export function firstLegForTariff(tariffCode: number): 'warehouse' | 'door' {
  return FIRST_LEG_BY_TARIFF[tariffCode] ?? 'warehouse';
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
  /** Тарифы «от двери»: address обязателен (apidoc.cdek.ru, from_location). */
  from_location?: { code?: number; address: string };
  delivery_point?: string;
  /** Тарифы «до двери»: address обязателен + идентификация города (code|city|postal_code). */
  to_location?: { code?: number; city?: string; postal_code?: string; address: string };
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
  /**
   * Адрес отправления (CDEK_FROM_ADDRESS) — обязателен для тарифов «от двери»
   * (from_location.address, фикс 3); для тарифов «от склада» не используется.
   */
  fromAddress: string | null;
  shipmentPoint: string | null;
  /** Тариф ПВЗ/постамата (склад-склад, 136). */
  defaultTariffCode: number;
  /** Тариф курьера «до двери» (склад-дверь, 137) — выбирается для mode==='door'. */
  doorTariffCode: number;
  sender: {
    name: string | null;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    inn: string | null;
  };
}

/**
 * Телефон отправителя (CDEK_SENDER_PHONE) — та же нормализация, что у получателя,
 * но с понятной оператору ошибкой про конкретную env-переменную (фикс 8).
 */
function normalizeSenderPhone(raw: string): string {
  try {
    return normalizePhone(raw);
  } catch {
    throw new CdekError(
      'cdek_invalid_sender_phone',
      `Некорректный телефон отправителя CDEK_SENDER_PHONE: "${raw}". ` +
        'Задайте российский номер (10–11 цифр), например +79001234567.',
    );
  }
}

/**
 * Собирает payload создания отправления из заказа+позиций (порт buildPayload,
 * пересобран по боевому аудиту apidoc.cdek.ru 2026-07-09). Чистая: вход —
 * заказ/позиции/опции; никакого I/O.
 *
 * Отправитель — по ПЕРВОМУ ПЛЕЧУ тарифа (фикс 3, firstLegForTariff):
 *   • «от склада» → shipment_point ОБЯЗАТЕЛЕН (нет → cdek_shipment_point_required);
 *   • «от двери» → from_location { code, address } (address из CDEK_FROM_ADDRESS,
 *     пусто → cdek_from_address_required).
 *   shipment_point и from_location взаимоисключимы ВСЕГДА
 *   (v2_shipment_address_multivalued).
 *
 * Назначение: режим pvz/postamat → delivery_point (код ПВЗ); door → to_location
 * { code?, city?, address } — address обязателен (cdek_address_required) и хотя
 * бы одна идентификация города code|city (cdek_city_required) (фикс 4).
 *
 * ware_key — SKU-снимок с лимитом string(20) и уникальностью внутри упаковки
 * (фикс 1, buildWareKey). sender — только при непустых CDEK_SENDER_*; телефон
 * отправителя нормализуется (фикс 8). packages — одна упаковка, агрегированная
 * из позиций.
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

  // Тариф по режиму (M4): курьер (door) → doorTariffCode (склад-дверь), иначе
  // ПВЗ/постамат → defaultTariffCode (склад-склад). Раньше всегда defaultTariffCode
  // → курьер уходил с ПВЗ-тарифом.
  const tariffCode = mode === 'door' ? opts.doorTariffCode : opts.defaultTariffCode;

  // Отправитель (sender) — фикс 8: пустые CDEK_SENDER_* → ключ sender вообще не
  // включается (для типа 1 он опционален; пустой объект {} бессмыслен). Телефон
  // нормализуется с понятной ошибкой про CDEK_SENDER_PHONE.
  const senderPhone = opts.sender.phone ? normalizeSenderPhone(opts.sender.phone) : null;
  const sender: NonNullable<CdekOrderPayload['sender']> = {
    ...(opts.sender.name ? { company: opts.sender.name } : {}),
    ...(opts.sender.contactName ? { name: opts.sender.contactName } : {}),
    ...(opts.sender.email ? { email: opts.sender.email } : {}),
    ...(opts.sender.inn ? { tin: opts.sender.inn } : {}),
    ...(senderPhone ? { phones: [{ number: senderPhone }] } : {}),
  };

  // ware_key: лимит string(20) + уникальность внутри packages[].items[] (фикс 1).
  const usedWareKeys = new Set<string>();

  const payload: CdekOrderPayload = {
    type: 1,
    number: order.number,
    tariff_code: tariffCode,
    recipient: {
      name: order.customerName,
      phones: [{ number: normalizePhone(order.customerPhone) }],
      ...(order.customerEmail ? { email: order.customerEmail } : {}),
    },
    ...(Object.keys(sender).length > 0 ? { sender } : {}),
    packages: [
      {
        number: order.number,
        weight: pkg.weight,
        ...(pkg.length !== undefined ? { length: pkg.length } : {}),
        ...(pkg.width !== undefined ? { width: pkg.width } : {}),
        ...(pkg.height !== undefined ? { height: pkg.height } : {}),
        items: items.map((it) => ({
          name: it.nameSnapshot,
          ware_key: buildWareKey(it, usedWareKeys),
          payment: { value: 0 },
          cost: Number(it.unitPrice),
          amount: it.quantity,
          // Вес ЕДИНИЦЫ из снимка позиции (вариант→товар, 0026); пусто → дефолт магазина.
          weight: itemUnitWeight(it, opts.defaultDimensions.weightG),
        })),
      },
    ],
  };

  // Отправитель по первому плечу тарифа (фикс 3): shipment_point ⊕ from_location.
  if (firstLegForTariff(tariffCode) === 'warehouse') {
    if (!opts.shipmentPoint) {
      throw new CdekError(
        'cdek_shipment_point_required',
        'Задайте CDEK_SHIPMENT_POINT — код ПВЗ, откуда сдаёте посылки ' +
          '(обязателен для тарифов от склада).',
      );
    }
    payload.shipment_point = opts.shipmentPoint;
  } else {
    // Тариф «от двери»: from_location.address обязателен по документации.
    if (!opts.fromAddress) {
      throw new CdekError(
        'cdek_from_address_required',
        'Задайте CDEK_FROM_ADDRESS — адрес забора посылок ' +
          '(from_location.address обязателен для тарифов «от двери»).',
      );
    }
    payload.from_location = { code: opts.fromLocationCode, address: opts.fromAddress };
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
    // door (фикс 4): to_location = address (обязателен) + идентификация города
    // (числовой code из delivery_city_code и/или строковое city). Без города
    // СДЭК отклонит заказ — валидируем заранее с понятной оператору ошибкой.
    if (!order.deliveryAddress) {
      throw new CdekError(
        'cdek_address_required',
        `Для курьерской доставки (до двери) обязателен адрес получателя — ` +
          `у заказа ${order.number} он не заполнен.`,
      );
    }
    const cityCode = order.deliveryCityCode ?? undefined;
    const cityName = order.deliveryCity ?? undefined;
    if (cityCode === undefined && cityName === undefined) {
      throw new CdekError(
        'cdek_city_required',
        `Для курьерской доставки нужен город получателя (код СДЭК или название) — ` +
          `у заказа ${order.number} он не заполнен.`,
      );
    }
    payload.to_location = {
      ...(cityCode !== undefined ? { code: cityCode } : {}),
      ...(cityName !== undefined ? { city: cityName } : {}),
      address: order.deliveryAddress,
    };
  }

  return payload;
}

// -----------------------------------------------------------------------------
// Проверка состояния заказа (precondition).
// -----------------------------------------------------------------------------

/**
 * Оплачен ли заказ настолько, чтобы формировать накладную СДЭК (FF.md: накладная
 * создаётся ТОЛЬКО после поступления денег — иначе риск отправить неоплаченное).
 * Признак оплаты: payment_status='paid' (выставляет webhook эквайринга при
 * поступлении средств) ЛИБО статус заказа уже продвинут оператором за оплату
 * (paid/packed/shipped/...). Единый источник правды для cron, сервиса и UI.
 */
export function isOrderPaidForShipment(
  order: Pick<Order, 'paymentStatus' | 'status'>,
): boolean {
  return (
    order.paymentStatus === 'paid' ||
    ['paid', 'packed', 'shipped', 'delivered', 'completed'].includes(order.status)
  );
}

/** Причина, по которой нельзя создать отправление (для сообщения пользователю). */
export type ShipmentBlockReason = 'pickup' | 'not_paid';

/** Человекочитаемое объяснение, почему отправление недоступно. */
export function shipmentBlockMessage(reason: ShipmentBlockReason): string {
  switch (reason) {
    case 'pickup':
      return 'Самовывоз — отправление СДЭК не создаётся.';
    case 'not_paid':
      return 'Заказ ещё не оплачен. Накладная создаётся только после поступления оплаты — это защищает от отправки неоплаченного заказа.';
  }
}

/**
 * Можно ли создавать отправление для заказа (не самовывоз; оплачен ЛИБО включён
 * режим «накладная при заказе» для магазина без кассы — opts.createOnOrder).
 */
export function canCreateShipment(
  order: Order,
  opts: { createOnOrder?: boolean } = {},
): { ok: boolean; reason?: ShipmentBlockReason } {
  if (order.deliveryType === 'pickup') {
    return { ok: false, reason: 'pickup' };
  }
  // Гейт оплаты снимается только если магазин работает без кассы (createOnOrder):
  // тогда «нажал Оплатить» = подтверждение заказа, накладная формируется сразу.
  if (!opts.createOnOrder && !isOrderPaidForShipment(order)) {
    return { ok: false, reason: 'not_paid' };
  }
  return { ok: true };
}

/**
 * Нужно ли регистрировать накладную СДЭК СРАЗУ при оформлении заказа (режим
 * «магазин без онлайн-кассы», CDEK_CREATE_ON_ORDER). Чистое решение для горячего
 * пути POST /orders. Условия (все обязательны):
 *   • НЕ повторный idempotency-заказ (reused уже обрабатывался — не дёргаем СДЭК);
 *   • включён режим createOnOrder;
 *   • доставка НЕ самовывоз;
 *   • модуль cdek эффективно включён — единый рубильник (аудит 2026-07-09, находка
 *     #6: авто-создание обходило module toggle, дёргая СДЭК при выключенном модуле).
 */
export function wantsCdekShipmentOnOrder(args: {
  reused: boolean;
  createOnOrder: boolean;
  deliveryType: string;
  cdekModuleEnabled: boolean;
}): boolean {
  return (
    !args.reused &&
    args.createOnOrder &&
    args.deliveryType !== 'pickup' &&
    args.cdekModuleEnabled
  );
}

/** UI-состояние блока «Создать отправление» в карточке заказа. */
export interface ShipmentCreateUiState {
  /** Показывать кнопку ручного создания отправления. */
  showCreateButton: boolean;
  /** Показывать пояснение «накладная — после оплаты» (штатный режим с кассой). */
  showAwaitPaymentNotice: boolean;
  /** Показывать подсказку «магазин без кассы — накладная без ожидания оплаты». */
  showCreateWithoutPaymentHint: boolean;
}

/**
 * Чистое решение, что рисовать в блоке создания отправления (карточка заказа) —
 * зеркало серверного canCreateShipment для UI. Ключевое (демо «без оплаты»):
 * при createOnOrder (магазин без онлайн-кассы) кнопка доступна и для
 * НЕОПЛАЧЕННОГО заказа — иначе UI прятал бы её в обход разрешающего сервера
 * (paymentReady раньше не учитывал createOnOrder). Самовывоз и уже созданное
 * отправление — ни кнопки, ни уведомлений.
 */
export function shipmentCreateUiState(args: {
  hasShipment: boolean;
  isPickup: boolean;
  paymentReady: boolean;
  createOnOrder: boolean;
}): ShipmentCreateUiState {
  const { hasShipment, isPickup, paymentReady, createOnOrder } = args;
  if (hasShipment || isPickup) {
    return {
      showCreateButton: false,
      showAwaitPaymentNotice: false,
      showCreateWithoutPaymentHint: false,
    };
  }
  const canCreateNow = paymentReady || createOnOrder;
  return {
    showCreateButton: canCreateNow,
    // «Ждём оплату» — только в штатном режиме с кассой (без createOnOrder).
    showAwaitPaymentNotice: !canCreateNow,
    // Подсказка про режим без кассы — когда флаг включён, а оплаты ещё нет.
    showCreateWithoutPaymentHint: createOnOrder && !paymentReady,
  };
}

// -----------------------------------------------------------------------------
// Разбор асинхронных 202-ответов методов заказов (apidoc.cdek.ru «Асинхронность»).
// -----------------------------------------------------------------------------

/** 202-ответ асинхронных методов заказов (POST/DELETE/refusal). */
interface CdekAsyncRaw {
  entity?: { uuid?: string };
  requests?: Array<{ state?: string; errors?: unknown; warnings?: unknown }>;
}

/**
 * true, если ошибка СДЭК означает «сущность не найдена» (GET /v2/orders?im_number
 * по несуществующему/удалённому заказу): HTTP 404 либо коды
 * v2_entity_not_found / v2_entity_not_found_im_number (apidoc.cdek.ru).
 */
function isCdekNotFound(err: CdekError): boolean {
  return (
    err.httpStatus === 404 ||
    err.cdekErrors.some(
      (e) => e.code === 'v2_entity_not_found' || e.code === 'v2_entity_not_found_im_number',
    )
  );
}

/** true, если какой-либо requests[].state === 'INVALID' (фоновая валидация отклонила). */
function hasInvalidRequestState(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const requests = (raw as Record<string, unknown>).requests;
  if (!Array.isArray(requests)) return false;
  return requests.some(
    (r) => r !== null && typeof r === 'object' && (r as Record<string, unknown>).state === 'INVALID',
  );
}

/**
 * Проверяет 202-ответ асинхронного метода заказов (фиксы 2/6/7): статус 202 —
 * лишь «запрос принят», фактический результат — в requests[].state / errors[].
 * INVALID ЛИБО любые errors[] → CdekError(errorCode) с человекочитаемым
 * перечислением code/message всех ошибок (extractCdekErrors: top-level + все
 * requests[].errors[]) и структурированными cdekErrors для программной обработки.
 */
function assertCdekRequestsOk(raw: unknown, errorCode: string, context: string): void {
  const cdekErrors = extractCdekErrors(raw);
  if (!hasInvalidRequestState(raw) && cdekErrors.length === 0) return;
  const details =
    cdekErrors.length > 0
      ? cdekErrors.map((e) => `${e.code}: ${e.message}`).join('; ')
      : 'requests[].state=INVALID (СДЭК не вернул детали ошибок)';
  throw new CdekError(errorCode, `${context}: ${details}`, { cdekErrors });
}

// -----------------------------------------------------------------------------
// OrderService.
// -----------------------------------------------------------------------------

export class OrderService {
  constructor(private readonly manager: CdekManager = getCdekManager()) {}

  /**
   * Низкоуровневое создание в СДЭК: POST /v2/orders → uuid.
   *
   * Фикс 2 (критический, аудит 2026-07-09): ответ 202 разбирается ПОЛНОСТЬЮ.
   * requests[].state=INVALID либо requests[].errors[] → CdekError
   * 'cdek_create_invalid' с деталями; entity.uuid при этом НЕ считается успехом
   * и не сохраняется (раньше INVALID-создание было невидимым — uuid принимался,
   * а накладной в СДЭК не существовало). ACCEPTED/WAITING/SUCCESSFUL без ошибок
   * + entity.uuid → успех.
   */
  async create(payload: CdekOrderPayload): Promise<{ uuid: string }> {
    const raw = await this.manager.client.request<CdekAsyncRaw>('POST', '/v2/orders', {
      json: payload,
    });
    assertCdekRequestsOk(raw, 'cdek_create_invalid', 'СДЭК отклонил регистрацию заказа');
    const uuid = raw?.entity?.uuid;
    if (!uuid) {
      throw new CdekError('cdek_create_no_uuid', 'СДЭК не вернул uuid отправления.');
    }
    return { uuid };
  }

  /**
   * Сверка «существует ли заказ в СДЭК» по номеру ИМ: GET /v2/orders?im_number=…
   * (идемпотентный, безопасен к авто-повтору). Возвращает uuid найденного заказа
   * или null при v2_entity_not_found_im_number / 404. Используется фиксом 5:
   * ПЕРЕД повторным POST после прошлой ошибки и СРАЗУ после
   * 'cdek_network_error_unconfirmed' (запрос МОГ выполниться на стороне СДЭК —
   * слепой повтор POST создал бы дубль накладной).
   */
  async findUuidByImNumber(imNumber: string): Promise<string | null> {
    try {
      const raw = await this.manager.client.request<CdekAsyncRaw>('GET', '/v2/orders', {
        query: { im_number: imNumber },
        idempotent: true,
      });
      const uuid = raw?.entity?.uuid;
      return typeof uuid === 'string' && uuid.length > 0 ? uuid : null;
    } catch (err) {
      if (err instanceof CdekError && isCdekNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * Низкоуровневая отмена. До приёмки груза — DELETE /v2/orders/{uuid}; после —
   * POST /v2/orders/{uuid}/refusal («Регистрация отказа», apidoc.cdek.ru).
   *
   * Фикс 6: раньше afterAcceptance слал PATCH {} — по документации PATCH это
   * ИЗМЕНЕНИЕ заказа и после движения груза запрещён (v2_update_forbidden);
   * операция отказа — отдельный endpoint refusal (тот же асинхронный 202).
   * Фикс 7: 202-ответ ОБОИХ методов разбирается (requests[].state INVALID /
   * errors[], в т.ч. v2_similar_request_still_processed) → CdekError, вызывающий
   * НЕ помечает отправление отменённым.
   */
  async cancel(uuid: string, afterAcceptance = false): Promise<void> {
    if (afterAcceptance) {
      const raw = await this.manager.client.request<CdekAsyncRaw>(
        'POST',
        `/v2/orders/${uuid}/refusal`,
      );
      assertCdekRequestsOk(raw, 'cdek_refusal_invalid', 'СДЭК отклонил регистрацию отказа');
    } else {
      const raw = await this.manager.client.request<CdekAsyncRaw>(
        'DELETE',
        `/v2/orders/${uuid}`,
      );
      assertCdekRequestsOk(raw, 'cdek_cancel_invalid', 'СДЭК отклонил удаление заказа');
    }
  }

  /**
   * Оркестратор создания отправления для заказа (docs/08 §7.1). Идемпотентен:
   *   • уже есть отправление с cdek_uuid → возвращаем его (без force);
   *   • pickup / неоплачен → ошибка precondition;
   *   • mock → фейковый uuid/трек; real → POST /v2/orders.
   * Сохраняет cdek_shipments + денормализует orders.cdek_uuid/cdek_track.
   *
   * АНТИ-ГОНКА (data-integrity). Создание отправления — неатомарный read-then-act:
   * read getShipmentByOrderId → удалённый side-effect POST /v2/orders (real) →
   * только потом INSERT cdek_shipments. UNIQUE uq_cdek_shipments_order защищает
   * лишь локальный INSERT, но НЕ удалённый POST. При гонке (двойной тик cron /
   * ручное создание из админки параллельно с cron) оба вызова видели existing=
   * null, оба POST-или в СДЭК → ДВЕ реальные накладные; второй INSERT падал на
   * unique, оставляя осиротевшую дублирующую накладную в СДЭК.
   *
   * Фикс: ВСЯ критическая секция (re-check существования → выбор источника →
   * (real) удалённый POST → запись cdek_shipments + денормализация orders) идёт
   * внутри ОДНОЙ транзакции под per-order транзакционным advisory-lock
   * pg_try_advisory_xact_lock(hashtext('cdek-create-shipment:'||orderId)). Лок
   * держится до конца транзакции, поэтому удалённый POST для одного заказа делает
   * ТОЛЬКО ОДИН воркер; проигравший try-lock завершается без удалённого вызова
   * (CdekError contention). Перепроверка getShipmentByOrderId ПОД ЛОКОМ ловит
   * случай, когда конкурент успел создать отправление между pre-check и захватом
   * лока — тогда возвращаем существующее (идемпотентность), без второго POST.
   */
  async createShipment(
    orderId: string,
    opts: { force?: boolean } = {},
  ): Promise<CdekShipment> {
    // Быстрый pre-check вне лока: если отправление уже есть — не открываем
    // транзакцию/не берём лок (дешёвый happy-path идемпотентности).
    const pre = await getShipmentByOrderId(orderId);
    if (pre?.cdekUuid && !opts.force) {
      return pre; // идемпотентность: уже создано
    }

    return await sql.begin<CdekShipment>(async (tx: TransactionSql) => {
      // Транзакционный advisory-lock по заказу: только один воркер входит в
      // критическую секцию для данного orderId. Ключ — hashtext(стабильная строка).
      const lockRows = await tx<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(
          hashtext(${'cdek-create-shipment:' + orderId})
        ) AS locked
      `;
      const acquired = lockRows[0]?.locked === true;
      if (!acquired) {
        // Другой воркер уже создаёт отправление для этого заказа — не дублируем
        // удалённый POST. Понятная ошибка contention (cron посчитает failed,
        // следующий тик подхватит, если первый воркер не довёл до конца).
        throw new CdekError(
          'cdek_create_in_progress',
          `Создание отправления для заказа ${orderId} уже выполняется другим процессом.`,
        );
      }

      // Перепроверка ПОД ЛОКОМ: конкурент мог создать отправление между pre-check
      // и захватом лока → возвращаем существующее (без второго удалённого POST).
      const existing = await getShipmentByOrderId(orderId);
      if (existing?.cdekUuid && !opts.force) {
        return existing;
      }

      return await this.createShipmentLocked(orderId, existing);
    });
  }

  /**
   * Критическая секция создания отправления (вызывается ПОД per-order advisory-
   * lock из createShipment). Загружает заказ, проверяет precondition, выбирает
   * mock/real, пишет cdek_shipments и денормализует orders. На ошибке бампит
   * retry_count (как и раньше) и пробрасывает исключение наружу.
   */
  private async createShipmentLocked(
    orderId: string,
    existing: CdekShipment | null,
  ): Promise<CdekShipment> {
    const loaded: OrderWithItems | null = await getOrderById(orderId);
    if (!loaded) {
      throw new CdekError('cdek_order_not_found', `Заказ ${orderId} не найден.`);
    }
    const { order, items } = loaded;

    const precond = canCreateShipment(order, {
      createOnOrder: this.manager.config.createOnOrder,
    });
    if (!precond.ok) {
      throw new CdekError(
        'cdek_precondition_failed',
        shipmentBlockMessage(precond.reason!),
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
        // Фикс 5 (high, анти-дубль накладных). POST /v2/orders неидемпотентен и
        // клиентом НЕ авторетраится; «повтор» возможен только через сверку:
        //   (а) прошлая попытка неуспешна (existing.error, cron-ретрай/force
        //       после ошибки) → СНАЧАЛА GET /v2/orders?im_number=<number>. Заказ
        //       уже существует в СДЭК (например, прошлый POST дошёл, а ответ
        //       потерялся) → принимаем его uuid БЕЗ второго POST; не найден
        //       (v2_entity_not_found_im_number) → создаём как обычно.
        //   (б) сам POST упал 'cdek_network_error_unconfirmed' (МОГ выполниться
        //       на стороне СДЭК) → та же сверка немедленно; найден → успех;
        //       не найден → пробрасываем исходную ошибку (cron-ретрай позже
        //       снова начнёт со сверки (а)).
        let uuid: string | null = null;
        if (existing?.error) {
          uuid = await this.findUuidByImNumber(order.number);
        }
        if (!uuid) {
          const payload = buildPayload(order, items, {
            defaultDimensions: cfg.defaultDimensions,
            fromLocationCode: cfg.fromLocationCode,
            fromAddress: cfg.fromAddress,
            shipmentPoint: cfg.shipmentPoint,
            defaultTariffCode: cfg.defaultTariffCode,
            doorTariffCode: cfg.doorTariffCode,
            sender: cfg.sender,
          });
          try {
            uuid = (await this.create(payload)).uuid;
          } catch (err) {
            if (err instanceof CdekError && err.code === 'cdek_network_error_unconfirmed') {
              // Сбой сверки не должен затенить исходную ошибку — .catch(null).
              const found = await this.findUuidByImNumber(order.number).catch(() => null);
              if (!found) throw err;
              uuid = found;
            } else {
              throw err;
            }
          }
        }
        cdekUuid = uuid;
        cdekNumber = null; // трек придёт позже (webhook/tracking)
        isMock = false;
      }

      const shipmentFields = {
        cdekUuid,
        cdekNumber,
        tariffCode: order.deliveryType === 'pickup' ? null : tariffForMode(cfg, mode),
        pvzCode: order.deliveryPvzCode,
        deliveryMode: mode,
        weightG: pkg.weight,
        lengthCm: pkg.length ?? null,
        widthCm: pkg.width ?? null,
        heightCm: pkg.height ?? null,
        isMock,
        error: null,
      };

      // existing-ветка: пере-создание накладной. clearError=true ЯВНО сбрасывает
      // error и retry_count прошлой неудачи (баг B волны 7) — COALESCE(error) при
      // error=null оставил бы старый текст, и оператор видел бы «ошибку» на
      // фактически успешной накладной.
      const saved = existing
        ? await updateShipmentByOrderId(orderId, { ...shipmentFields, clearError: true })
        : await repoCreateShipment({ orderId, ...shipmentFields });

      // Денормализация на orders (горячие поля для списков/витрины).
      await sql`
        UPDATE orders
           SET cdek_uuid = ${cdekUuid},
               cdek_track = ${cdekNumber},
               updated_at = now()
         WHERE id = ${orderId}
      `;

      // БАГ #9 (аудит волны 15): накладная создана (cdek_uuid выставлен) → переводим
      // delivery_status pending→registered. Иначе заказ застревает в 'pending', а первое
      // webhook-событие СДЭК (например in_transit) даёт НЕДОПУСТИМЫЙ переход из pending
      // (машина: pending→registered/cancelled) → статус доставки навсегда залипает.
      // Идемпотентно: applyDeliveryStatus применит переход только если он валиден
      // (из pending); если статус уже продвинут — no-op.
      await applyDeliveryStatus(orderId, 'registered', 'cdek-waybill-created');

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
   *
   * БАГ #12 (precondition, анти-рассинхрон): переход delivery_status → cancelled
   * разрешён статус-машиной (lib/orders/status.ts) ТОЛЬКО из pending/registered.
   * Если заказ уже in_transit/delivered/returned/cancelled — applyDeliveryStatus
   * вернул бы false (no-op), а отправление мы бы уже пометили CANCELLED и (в боевом)
   * реально отменили в СДЭК → рассинхрон «отправление CANCELLED ↔ delivery_status
   * остался in_transit». Выбран САМЫЙ БЕЗОПАСНЫЙ вариант: проверяем допустимость
   * перехода ДО любых побочных эффектов (нет вызова СДЭК, нет пометки отправления)
   * и бросаем понятный CdekError. Семантика статус-машины не размывается: посылку,
   * которая уже в пути/доставлена, нельзя «отменить» — для неё существует ветка
   * returned, а не cancelled. Это тот же защитный приём, что canCreateShipment.
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

    // Precondition: отмена допустима лишь из pending/registered. Иначе — никаких
    // побочных эффектов (СДЭК не дёргаем, отправление не помечаем), понятная ошибка.
    const loaded = await getOrderById(orderId);
    if (!loaded) {
      throw new CdekError('cdek_order_not_found', `Заказ ${orderId} не найден.`);
    }
    const from = loaded.order.deliveryStatus;
    if (!canTransitionDelivery(from, 'cancelled')) {
      throw new CdekError(
        'cdek_cancel_not_allowed',
        `Нельзя отменить отправление: статус доставки "${from}" не допускает отмену ` +
          `(отмена возможна только из pending/registered). Посылку в пути/доставленную ` +
          `следует оформлять через возврат, а не отмену.`,
      );
    }

    if (!this.manager.isMock) {
      await this.cancel(shipment.cdekUuid, opts.afterAcceptance);
    }

    // C6-1 (TOCTOU, анти-рассинхрон): ранняя precondition выше читает delivery_status
    // ДО эффектов, но между ней и переходом параллельный webhook мог продвинуть статус
    // (registered→in_transit). applyDeliveryStatus применяет переход под SELECT … FOR
    // UPDATE — это АВТОРИТЕТНАЯ проверка под локом. Помечаем отправление CANCELLED ТОЛЬКО
    // если переход реально применился; иначе был бы рассинхрон «shipment=CANCELLED ↔
    // delivery_status=in_transit». Не применился (статус успел уйти) → бросаем, отправление
    // НЕ трогаем (оператор сверяет вручную; cancelled — терминал, после успеха гонок нет).
    const applied = await applyDeliveryStatus(orderId, 'cancelled');
    if (!applied) {
      throw new CdekError(
        'cdek_cancel_raced',
        'Статус доставки изменился во время отмены (стал не-отменяемым) — отправление НЕ ' +
          'помечено отменённым. Требуется ручная сверка.',
      );
    }

    await updateShipmentByOrderId(orderId, {
      statusCode: 'CANCELLED',
      statusName: 'Отменён',
      statusAt: new Date(),
    });
  }
}

// -----------------------------------------------------------------------------
// Общий хелпер смены delivery_status (через статус-машину, без Server Actions).
// Реэкспортируется из tracking.ts/webhook.ts через общий модуль.
// -----------------------------------------------------------------------------

import { applyDeliveryStatus } from './delivery-status';
