/**
 * StatusMap — ЧИСТЫЙ маппинг кодов статусов СДЭК → delivery_status заказа Admik
 * (docs/08 §2.4, изначально порт carre common/components/Cdek/StatusMap.php).
 *
 * Таблица ВЫВЕРЕНА по «Приложению 1. Статусы заказов» актуального apidoc.cdek.ru
 * (спека gateway.cdek.ru/api-cdek-docs, сверено 2026-07-09) — ревизия боевого
 * режима: легаси-коды carre, которых нет в Приложении 1 (READY_TO_SHIP_*,
 * ON_THE_WAY, READY_FOR_PICKUP, RETURNED_TO_SENDER, RETURNED_TO_SENDER_ACCEPTED,
 * LOST), удалены; добавлены реальные транзитные/постаматные/таможенные коды.
 * Неизвестный в рантайме код → категория 0 → null (лог + без перехода):
 * консервативно, чтобы не применить выдуманный статус.
 *
 * Без сети, без БД, без зависимости от manager — только статические таблицы и
 * чистые функции. Поэтому покрыт полной матрицей тестов и всегда зелёный.
 *
 * Двухступенчатый маппинг (как carre):
 *   1) код СДЭК → категория carre (0–5)  [STATUS_TO_CATEGORY];
 *   2) категория → DeliveryStatus Admik   [categoryToDeliveryStatus].
 *
 * Категории 1/2/3 коллапсируют в registered/in_transit, потому что статус-машина
 * Admik (lib/orders/status.ts) грубее: registered → in_transit → delivered/
 * returned. Переход применяет вызывающий (WebhookService/TrackingService) через
 * advanceDeliveryStatus — здесь только чистый маппинг «куда должны прийти».
 */

import type { DeliveryStatus } from '@/lib/orders/types';

// -----------------------------------------------------------------------------
// Таблицы (Приложение 1 apidoc.cdek.ru; в комментариях — числовой Status code).
// -----------------------------------------------------------------------------

/**
 * Код статуса СДЭК → категория carre (0–5):
 *   0 = создан, без накладной (дефолт неизвестных)
 *   1 = накладная создана, ожидает приёмки
 *   2 = в пути
 *   3 = прибыл в город получателя / готов к выдаче
 *   4 = вручён (терминальный успех)
 *   5 = проблема/возврат/отмена (терминальный)
 */
export const STATUS_TO_CATEGORY: Readonly<Record<string, 0 | 1 | 2 | 3 | 4 | 5>> = {
  // --- Категория 1: зарегистрирован, груз ещё не принят СДЭК.
  ACCEPTED: 1, // 0 — принят в ИС СДЭК, идут валидации
  CREATED: 1, // 1 — зарегистрирован в базе СДЭК

  // --- Категория 2: в пути (отправитель/транзит).
  RECEIVED_AT_SHIPMENT_WAREHOUSE: 2, // 3 — приход на склад отправителя
  READY_FOR_SHIPMENT_IN_SENDER_CITY: 2, // 6 — расход со склада отправителя
  TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY: 2, // 7 — сдан перевозчику
  SENT_TO_RECIPIENT_CITY: 2, // 8 — отправлен в город-получатель
  ACCEPTED_AT_TRANSIT_WAREHOUSE: 2, // 13 — приход в городе-транзите
  // 16 — повторный приход в городе-отправителе. ВАЖНО: по Приложению 1 «этот
  // статус не означает возврат груза отправителю» — посылка продолжает путь,
  // финальный статус придёт позже. НЕ терминал (ранее ошибочно вёл в returned).
  RETURNED_TO_SENDER_CITY_WAREHOUSE: 2,
  RETURNED_TO_TRANSIT_WAREHOUSE: 2, // 17 — возвращён на склад транзита (не возврат)
  READY_FOR_SHIPMENT_IN_TRANSIT_CITY: 2, // 19 — расход в городе-транзите
  TAKEN_BY_TRANSPORTER_FROM_TRANSIT_CITY: 2, // 20 — сдан перевозчику в транзите
  SENT_TO_TRANSIT_CITY: 2, // 21 — отправлен в город-транзит
  ACCEPTED_IN_TRANSIT_CITY: 2, // 22 — встречен в городе-транзите
  SENT_TO_SENDER_CITY: 2, // 27 — отправлен в город-отправитель
  ACCEPTED_IN_SENDER_CITY: 2, // 28 — встречен в городе-отправителе
  ENTERED_TO_TRANSIT_WAREHOUSE: 2, // 1000 — приёмка в городе-транзите
  IN_CUSTOMS_INTERNATIONAL: 2, // 1000 — таможня в стране отправления (межд.)
  SHIPPED_TO_DESTINATION: 2, // 1000 — отправлено в страну назначения (межд.)
  PASSED_TO_TRANSIT_CARRIER: 2, // 1000 — передано транзитному перевозчику (межд.)
  IN_CUSTOMS_LOCAL: 2, // 1000 — таможня в стране назначения (межд.)
  CUSTOMS_COMPLETE: 2, // 1000 — таможенное оформление завершено (межд.)

  // --- Категория 3: прибыл в город получателя / готов к выдаче.
  ACCEPTED_IN_RECIPIENT_CITY: 3, // 9 — встречен в городе-получателе
  ACCEPTED_AT_RECIPIENT_CITY_WAREHOUSE: 3, // 10 — приход на склад доставки (до двери)
  TAKEN_BY_COURIER: 3, // 11 — выдан курьеру на доставку
  ACCEPTED_AT_PICK_UP_POINT: 3, // 12 — на складе до востребования (ждёт клиента)
  RETURNED_TO_RECIPIENT_CITY_WAREHOUSE: 3, // 18 — повторный приход, ждёт новой попытки
  ENTERED_TO_RECIPIENT_CITY_WAREHOUSE: 3, // 1000 — приёмка на складе доставки
  ENTERED_TO_PICK_UP_POINT: 3, // 1000 — приёмка на складе до востребования
  POSTOMAT_POSTED: 3, // 1000 — заложен в постамат, ждёт клиента

  // --- Категория 4: вручение (терминальный успех).
  DELIVERED: 4, // 4 — вручён
  POSTOMAT_RECEIVED: 4, // 1000 — изъят из постамата клиентом

  // --- Категория 5: невручение/проблема/отмена (терминальные).
  NOT_DELIVERED: 5, // 5 — не вручён, возврат в ИМ
  POSTOMAT_SEIZED: 5, // 1000 — истёк срок хранения в постамате, возврат в ИМ
  INVALID: 5, // 404 — некорректный заказ
  REMOVED: 5, // 2 — удалён (отменён ИМ до прихода груза); спец-кейс → cancelled
  // ВНУТРЕННИЙ sentinel (НЕ приходит от СДЭК, нет в Приложении 1): его пишет наш
  // OrderService.cancelShipment в cdek_shipments.status_code при отмене
  // отправления. Оставлен в таблице сознательно, чтобы displayName/маппинг были
  // консистентны для записей БД; спец-кейс → cancelled.
  CANCELLED: 5,
};

/** Русские человекочитаемые имена статусов (Приложение 1 + внутренние sentinel). */
export const STATUS_TO_NAME: Readonly<Record<string, string>> = {
  ACCEPTED: 'Принят',
  CREATED: 'Создан',
  REMOVED: 'Удалён',
  RECEIVED_AT_SHIPMENT_WAREHOUSE: 'Принят на склад отправителя',
  DELIVERED: 'Вручён',
  NOT_DELIVERED: 'Не вручён',
  READY_FOR_SHIPMENT_IN_SENDER_CITY: 'Готов к отправке в городе-отправителе',
  TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY: 'Сдан перевозчику в городе-отправителе',
  SENT_TO_RECIPIENT_CITY: 'Отправлен в город-получатель',
  ACCEPTED_IN_RECIPIENT_CITY: 'Встречен в городе-получателе',
  ACCEPTED_AT_RECIPIENT_CITY_WAREHOUSE: 'Принят на склад доставки',
  TAKEN_BY_COURIER: 'Выдан на доставку',
  ACCEPTED_AT_PICK_UP_POINT: 'Принят на склад до востребования',
  ACCEPTED_AT_TRANSIT_WAREHOUSE: 'Принят на склад транзита',
  RETURNED_TO_SENDER_CITY_WAREHOUSE: 'Возвращён на склад отправителя',
  RETURNED_TO_TRANSIT_WAREHOUSE: 'Возвращён на склад транзита',
  RETURNED_TO_RECIPIENT_CITY_WAREHOUSE: 'Возвращён на склад доставки',
  READY_FOR_SHIPMENT_IN_TRANSIT_CITY: 'Выдан на отправку в городе-транзите',
  TAKEN_BY_TRANSPORTER_FROM_TRANSIT_CITY: 'Сдан перевозчику в городе-транзите',
  SENT_TO_TRANSIT_CITY: 'Отправлен в город-транзит',
  ACCEPTED_IN_TRANSIT_CITY: 'Встречен в городе-транзите',
  SENT_TO_SENDER_CITY: 'Отправлен в город-отправитель',
  ACCEPTED_IN_SENDER_CITY: 'Встречен в городе-отправителе',
  ENTERED_TO_TRANSIT_WAREHOUSE: 'Поступил в город транзита',
  ENTERED_TO_RECIPIENT_CITY_WAREHOUSE: 'Поступил на склад доставки',
  ENTERED_TO_PICK_UP_POINT: 'Поступил на склад до востребования',
  IN_CUSTOMS_INTERNATIONAL: 'Таможенное оформление в стране отправления',
  SHIPPED_TO_DESTINATION: 'Отправлено в страну назначения',
  PASSED_TO_TRANSIT_CARRIER: 'Передано транзитному перевозчику',
  IN_CUSTOMS_LOCAL: 'Таможенное оформление в стране назначения',
  CUSTOMS_COMPLETE: 'Таможенное оформление завершено',
  POSTOMAT_POSTED: 'Заложен в постамат',
  POSTOMAT_SEIZED: 'Изъят из постамата (возврат)',
  POSTOMAT_RECEIVED: 'Изъят из постамата клиентом',
  INVALID: 'Некорректный заказ',
  // Внутренние sentinel-коды Admik (не из Приложения 1):
  CANCELLED: 'Отменён', // ставит OrderService.cancelShipment
  NOT_FOUND: 'Не найден в СДЭК', // ставит TrackingService при v2_entity_not_found
};

/**
 * Код → шаблон клиентского письма (порт STATUS_TO_TEMPLATE carre, коды выверены
 * по Приложению 1). null = без письма. CREATED/ACCEPTED намеренно отсутствуют —
 * технические статусы.
 */
export const STATUS_TO_CLIENT_TEMPLATE: Readonly<Record<string, string>> = {
  RECEIVED_AT_SHIPMENT_WAREHOUSE: 'cdek_accepted',
  ACCEPTED_IN_RECIPIENT_CITY: 'cdek_in_transit',
  SENT_TO_RECIPIENT_CITY: 'cdek_in_transit',
  ACCEPTED_AT_PICK_UP_POINT: 'cdek_ready_for_pickup',
  ENTERED_TO_PICK_UP_POINT: 'cdek_ready_for_pickup',
  POSTOMAT_POSTED: 'cdek_ready_for_pickup',
  TAKEN_BY_COURIER: 'cdek_courier_dispatched',
  DELIVERED: 'cdek_delivered',
  POSTOMAT_RECEIVED: 'cdek_delivered',
};

/** Код → шаблон админ-письма о проблеме (терминальные проблемы Приложения 1). */
export const STATUS_TO_ADMIN_TEMPLATE: Readonly<Record<string, string>> = {
  NOT_DELIVERED: 'cdek_problem',
  POSTOMAT_SEIZED: 'cdek_problem',
  REMOVED: 'cdek_problem',
  CANCELLED: 'cdek_problem', // внутренний sentinel отмены отправления
  INVALID: 'cdek_problem',
};

// -----------------------------------------------------------------------------
// Чистые функции маппинга.
// -----------------------------------------------------------------------------

/** Код СДЭК → категория carre (0–5). Неизвестный → 0. */
export function categorize(code: string): 0 | 1 | 2 | 3 | 4 | 5 {
  return STATUS_TO_CATEGORY[code] ?? 0;
}

/**
 * Категория carre (0–5) → DeliveryStatus Admik.
 *   0 → null (без накладной — нечего применять)
 *   1 → registered; 2/3 → in_transit; 4 → delivered; 5 → returned (дефолт проблемы)
 *
 * Внимание: категория 5 включает и отмену (REMOVED/CANCELLED → cancelled).
 * Поэтому для точного маппинга используйте mapCdekStatus(code), который различает
 * отмену по коду; categoryToDeliveryStatus(5) даёт «проблема/возврат» = returned.
 */
export function categoryToDeliveryStatus(category: number): DeliveryStatus | null {
  switch (category) {
    case 1:
      return 'registered';
    case 2:
    case 3:
      return 'in_transit';
    case 4:
      return 'delivered';
    case 5:
      return 'returned';
    case 0:
    default:
      return null;
  }
}

/**
 * Главная функция: код статуса СДЭК → DeliveryStatus заказа Admik.
 * Неизвестный код → warn-лог + null (вызывающий пропускает переход) —
 * КОНСЕРВАТИВНО: не выдумываем переход для кода, которого нет в Приложении 1.
 *
 * Особые случаи категории 5 → 'cancelled':
 *   • REMOVED — финальный «Удален» Приложения 1 (заказ отменён ИМ после
 *     регистрации до прихода груза на склад СДЭК);
 *   • CANCELLED — внутренний sentinel нашего cancelShipment (от СДЭК не приходит).
 * Остальные коды категории 5 (невручение/проблема) → 'returned'.
 */
export function mapCdekStatus(code: string): DeliveryStatus | null {
  if (!code) return null;
  if (code === 'REMOVED' || code === 'CANCELLED') return 'cancelled';
  if (!(code in STATUS_TO_CATEGORY)) {
    console.warn(`[cdek/status-map] неизвестный код статуса СДЭК «${code}» — переход пропущен.`);
    return null;
  }
  return categoryToDeliveryStatus(categorize(code));
}

/** Русское имя статуса; для неизвестного кода — сам код. */
export function displayName(code: string): string {
  return STATUS_TO_NAME[code] ?? code;
}

/** Шаблон клиентского письма для кода или null. */
export function clientEmailTemplate(code: string): string | null {
  return STATUS_TO_CLIENT_TEMPLATE[code] ?? null;
}

/** Шаблон админ-письма (проблема) для кода или null. */
export function adminEmailTemplate(code: string): string | null {
  return STATUS_TO_ADMIN_TEMPLATE[code] ?? null;
}

/**
 * Объект-фасад StatusMap (совместимость с контрактом docs/08 §2.4).
 * Дублирует чистые функции выше для потребителей, ожидающих namespace-API.
 */
export const StatusMap = {
  categorize,
  categoryToDeliveryStatus,
  toDeliveryStatus: mapCdekStatus,
  displayName,
  clientEmailTemplate,
  adminEmailTemplate,
} as const;
