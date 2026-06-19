/**
 * Статус-машины модуля orders как ДАННЫЕ (whitelist переходов) + чистые функции
 * (docs/07 §2.8). Единый источник истины переходов — здесь, а не разбросан по
 * коду (как RBAC по кодам, ADR-005): UI рисует кнопки только разрешённых из
 * текущего статуса переходов; сервер валидирует переход той же таблицей.
 *
 * Три независимые, но связанные машины: статус заказа / оплаты / доставки.
 * Все функции чистые и тестируемые (без БД).
 */

import type { DeliveryStatus, OrderStatus, PaymentStatus } from './types';

// -----------------------------------------------------------------------------
// Таблицы допустимых переходов (whitelist). Ключ — «из», значение — список «в».
// Пустой список → терминальный статус (исходящих переходов нет).
// -----------------------------------------------------------------------------

/**
 * (A) Статус заказа (orders.status), §2.8 A.
 *
 *   new ─► awaiting_payment ─► paid ─► packed ─► shipped ─► delivered ─► completed
 *   cancelled — из любого ДО shipped; refunded — из paid/packed/shipped/delivered/completed.
 */
export const ORDER_STATUS_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  new: ['awaiting_payment', 'paid', 'cancelled'],
  awaiting_payment: ['paid', 'cancelled'],
  paid: ['packed', 'cancelled', 'refunded'],
  packed: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['completed', 'refunded'],
  completed: ['refunded'],
  cancelled: [],
  refunded: [],
};

/**
 * (B) Статус оплаты (orders.payment_status), §2.8 B.
 *   pending ─► authorized ─► paid; ветви → failed; paid → refunded.
 *   На Этапе 3 переходы ручные/mock (нет провайдера). paid проставляет paid_at.
 */
export const PAYMENT_STATUS_TRANSITIONS: Readonly<
  Record<PaymentStatus, readonly PaymentStatus[]>
> = {
  pending: ['authorized', 'paid', 'failed'],
  authorized: ['paid', 'failed'],
  paid: ['refunded'],
  failed: ['pending'],
  refunded: [],
};

/**
 * (C) Статус доставки (orders.delivery_status), §2.8 C.
 *   pending ─► registered ─► in_transit ─► delivered; ветви → returned, → cancelled.
 *   Источник истины в Этапе 4 — СДЭК webhook; на Этапе 3 — ручная смена в админке.
 */
export const DELIVERY_STATUS_TRANSITIONS: Readonly<
  Record<DeliveryStatus, readonly DeliveryStatus[]>
> = {
  pending: ['registered', 'cancelled'],
  registered: ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'returned'],
  delivered: ['returned'],
  returned: [],
  cancelled: [],
};

// -----------------------------------------------------------------------------
// Обобщённое ядро (одна реализация на три машины).
// -----------------------------------------------------------------------------

/** Машина-дискриминатор для выбора таблицы переходов и текста ошибки. */
export type StatusMachine = 'order' | 'payment' | 'delivery';

const TRANSITIONS: Record<StatusMachine, Readonly<Record<string, readonly string[]>>> = {
  order: ORDER_STATUS_TRANSITIONS,
  payment: PAYMENT_STATUS_TRANSITIONS,
  delivery: DELIVERY_STATUS_TRANSITIONS,
};

const MACHINE_LABEL: Record<StatusMachine, string> = {
  order: 'заказа',
  payment: 'оплаты',
  delivery: 'доставки',
};

/**
 * Чистая проверка: допустим ли переход `from → to` в указанной машине.
 * Переход в тот же статус (`from === to`) считается НЕдопустимым (no-op не нужен).
 */
export function canTransition(
  machine: StatusMachine,
  from: string,
  to: string,
): boolean {
  const next = TRANSITIONS[machine][from];
  if (!next) return false; // неизвестный исходный статус
  return next.includes(to);
}

/**
 * Бросает понятную ошибку, если переход недопустим (для серверной валидации).
 * Возвращает void при допустимом переходе.
 */
export function assertTransition(
  machine: StatusMachine,
  from: string,
  to: string,
): void {
  if (!canTransition(machine, from, to)) {
    throw new Error(
      `Недопустимый переход статуса ${MACHINE_LABEL[machine]}: ` +
        `"${from}" → "${to}".`,
    );
  }
}

/**
 * Список допустимых следующих статусов из текущего (для отрисовки кнопок в UI).
 * Неизвестный статус → пустой список.
 */
export function nextStatuses(machine: StatusMachine, from: string): readonly string[] {
  return TRANSITIONS[machine][from] ?? [];
}

/** Терминален ли статус (нет исходящих переходов). */
export function isTerminal(machine: StatusMachine, status: string): boolean {
  const next = TRANSITIONS[machine][status];
  return next !== undefined && next.length === 0;
}

// -----------------------------------------------------------------------------
// Типобезопасные обёртки на каждую машину (узкие типы статусов).
// -----------------------------------------------------------------------------

/** Допустим ли переход статуса ЗАКАЗА from → to. */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return canTransition('order', from, to);
}

/** Допустим ли переход статуса ОПЛАТЫ from → to. */
export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return canTransition('payment', from, to);
}

/** Допустим ли переход статуса ДОСТАВКИ from → to. */
export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return canTransition('delivery', from, to);
}

/** Допустимые следующие статусы заказа из текущего. */
export function nextOrderStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[from] ?? [];
}

/** Допустимые следующие статусы оплаты из текущего. */
export function nextPaymentStatuses(from: PaymentStatus): readonly PaymentStatus[] {
  return PAYMENT_STATUS_TRANSITIONS[from] ?? [];
}

/** Допустимые следующие статусы доставки из текущего. */
export function nextDeliveryStatuses(from: DeliveryStatus): readonly DeliveryStatus[] {
  return DELIVERY_STATUS_TRANSITIONS[from] ?? [];
}

/**
 * Новый статус ОПЛАТЫ при отмене/возврате заказа (или null = не менять).
 *
 * Деньги возвращаем (payment → 'refunded') ТОЛЬКО если они реально получены
 * (payment === 'paid'). Для pending/failed/authorized (деньги НЕ списаны) —
 * оставляем как есть: иначе (а) фиксировался бы фантомный «возврат» по
 * неоплаченному заказу (завышение сумм возвратов в отчётности), (б) писался бы
 * запрещённый машиной переход pending→refunded. Симметрично закрывает два бага:
 *  - отмена ОПЛАЧЕННОГО заказа теперь оформляет возврат (а не «теряет» деньги);
 *  - возврат COD-заказа (payment='pending') НЕ штампует ложный 'refunded'.
 */
export function paymentStatusOnSettle(
  payment: PaymentStatus,
  toOrderStatus: OrderStatus,
): PaymentStatus | null {
  if (toOrderStatus !== 'cancelled' && toOrderStatus !== 'refunded') return null;
  return payment === 'paid' ? 'refunded' : null;
}
