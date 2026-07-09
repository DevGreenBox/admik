import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  STATUS_TO_CATEGORY,
  STATUS_TO_NAME,
  categorize,
  categoryToDeliveryStatus,
  mapCdekStatus,
  displayName,
  clientEmailTemplate,
  adminEmailTemplate,
} from '@/lib/cdek/services/status-map';
import { DELIVERY_STATUS_TRANSITIONS } from '@/lib/orders/status';
import type { DeliveryStatus } from '@/lib/orders/types';

/**
 * Полная матрица маппинга кодов статусов СДЭК → delivery_status заказа Admik
 * (docs/08 §2.4). StatusMap — чистый, без сети/БД → всегда зелёный.
 *
 * Таблица выверена по «Приложению 1. Статусы заказов» актуального apidoc.cdek.ru
 * (спека gateway.cdek.ru/api-cdek-docs, сверено 2026-07-09). Категории carre
 * (1–5) коллапсируют в DeliveryStatus Admik:
 *   1 → registered, 2/3 → in_transit, 4 → delivered, 5 → returned|cancelled.
 */

// Ожидаемая матрица код → DeliveryStatus (Приложение 1, apidoc.cdek.ru).
const EXPECTED: Record<string, DeliveryStatus> = {
  // Категория 1 → registered
  ACCEPTED: 'registered', // 0
  CREATED: 'registered', // 1
  // Категория 2 (в пути) → in_transit
  RECEIVED_AT_SHIPMENT_WAREHOUSE: 'in_transit', // 3
  READY_FOR_SHIPMENT_IN_SENDER_CITY: 'in_transit', // 6
  TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY: 'in_transit', // 7
  SENT_TO_RECIPIENT_CITY: 'in_transit', // 8
  ACCEPTED_AT_TRANSIT_WAREHOUSE: 'in_transit', // 13
  RETURNED_TO_SENDER_CITY_WAREHOUSE: 'in_transit', // 16 — НЕ терминал (см. ниже)
  RETURNED_TO_TRANSIT_WAREHOUSE: 'in_transit', // 17
  READY_FOR_SHIPMENT_IN_TRANSIT_CITY: 'in_transit', // 19
  TAKEN_BY_TRANSPORTER_FROM_TRANSIT_CITY: 'in_transit', // 20
  SENT_TO_TRANSIT_CITY: 'in_transit', // 21
  ACCEPTED_IN_TRANSIT_CITY: 'in_transit', // 22
  SENT_TO_SENDER_CITY: 'in_transit', // 27
  ACCEPTED_IN_SENDER_CITY: 'in_transit', // 28
  ENTERED_TO_TRANSIT_WAREHOUSE: 'in_transit', // 1000
  IN_CUSTOMS_INTERNATIONAL: 'in_transit', // 1000 (международные)
  SHIPPED_TO_DESTINATION: 'in_transit', // 1000
  PASSED_TO_TRANSIT_CARRIER: 'in_transit', // 1000
  IN_CUSTOMS_LOCAL: 'in_transit', // 1000
  CUSTOMS_COMPLETE: 'in_transit', // 1000
  // Категория 3 (прибыл в город получателя / готов к выдаче) → in_transit
  ACCEPTED_IN_RECIPIENT_CITY: 'in_transit', // 9
  ACCEPTED_AT_RECIPIENT_CITY_WAREHOUSE: 'in_transit', // 10
  TAKEN_BY_COURIER: 'in_transit', // 11
  ACCEPTED_AT_PICK_UP_POINT: 'in_transit', // 12
  RETURNED_TO_RECIPIENT_CITY_WAREHOUSE: 'in_transit', // 18
  ENTERED_TO_RECIPIENT_CITY_WAREHOUSE: 'in_transit', // 1000
  ENTERED_TO_PICK_UP_POINT: 'in_transit', // 1000
  POSTOMAT_POSTED: 'in_transit', // 1000 — заложен в постамат, ждёт клиента
  // Категория 4 (вручение) → delivered
  DELIVERED: 'delivered', // 4
  POSTOMAT_RECEIVED: 'delivered', // 1000 — изъят из постамата клиентом
  // Категория 5 (невручение/проблема) → returned
  NOT_DELIVERED: 'returned', // 5
  POSTOMAT_SEIZED: 'returned', // 1000 — истёк срок хранения, возврат в ИМ
  INVALID: 'returned', // 404 — некорректный заказ
  // Категория 5 (отмена) → cancelled
  REMOVED: 'cancelled', // 2 — удалён на стороне СДЭК (финальный)
  CANCELLED: 'cancelled', // внутренний sentinel cancelShipment (НЕ приходит от СДЭК)
};

describe('cdek/status-map — полная матрица кодов → delivery_status', () => {
  for (const [code, expected] of Object.entries(EXPECTED)) {
    it(`${code} → ${expected}`, () => {
      expect(mapCdekStatus(code)).toBe(expected);
    });
  }

  it('покрывает все коды из таблицы STATUS_TO_CATEGORY', () => {
    const codes = Object.keys(STATUS_TO_CATEGORY);
    for (const code of codes) {
      // у каждого известного кода есть детерминированный DeliveryStatus
      expect(mapCdekStatus(code)).not.toBeNull();
    }
    // тестовая матрица охватывает все коды таблицы
    expect(Object.keys(EXPECTED).sort()).toEqual(codes.sort());
  });

  it('каждый результат — валидный DeliveryStatus статус-машины доставки', () => {
    const valid = Object.keys(DELIVERY_STATUS_TRANSITIONS);
    for (const code of Object.keys(EXPECTED)) {
      const ds = mapCdekStatus(code);
      expect(ds === null || valid.includes(ds)).toBe(true);
    }
  });
});

describe('cdek/status-map — ревизия по Приложению 1 (аудит боевого режима)', () => {
  it('REMOVED (код 2, финальный «Удален») → cancelled', () => {
    expect(mapCdekStatus('REMOVED')).toBe('cancelled');
  });

  it('RETURNED_TO_SENDER_CITY_WAREHOUSE — НЕ терминал (повторный приход в городе-отправителе)', () => {
    // Приложение 1, код 16: «этот статус не означает возврат груза отправителю».
    expect(mapCdekStatus('RETURNED_TO_SENDER_CITY_WAREHOUSE')).toBe('in_transit');
  });

  it('постаматные статусы замаплены (posted → in_transit, received → delivered, seized → returned)', () => {
    expect(mapCdekStatus('POSTOMAT_POSTED')).toBe('in_transit');
    expect(mapCdekStatus('POSTOMAT_RECEIVED')).toBe('delivered');
    expect(mapCdekStatus('POSTOMAT_SEIZED')).toBe('returned');
  });

  it('легаси-коды, которых нет в Приложении 1, удалены из таблицы → null (без перехода)', () => {
    for (const legacy of [
      'READY_TO_SHIP_AT_SENDING_OFFICE',
      'READY_TO_SHIP_IN_TRANSIT_OFFICE',
      'ON_THE_WAY',
      'READY_FOR_PICKUP',
      'RETURNED_TO_SENDER',
      'RETURNED_TO_SENDER_ACCEPTED',
      'LOST',
    ]) {
      expect(STATUS_TO_CATEGORY[legacy]).toBeUndefined();
      expect(mapCdekStatus(legacy)).toBeNull();
    }
  });
});

describe('cdek/status-map — неизвестные коды и дефолт', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('неизвестный код → null (дефолт; вызывающий пропускает переход) + warn-лог', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapCdekStatus('NOPE_NOT_A_CODE')).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(mapCdekStatus('')).toBeNull();
    expect(warn).toHaveBeenCalledOnce(); // пустой код — не warn (нет данных)
  });

  it('categorize неизвестного кода → 0', () => {
    expect(categorize('NOPE')).toBe(0);
    expect(categorize('CREATED')).toBe(1);
    expect(categorize('DELIVERED')).toBe(4);
  });

  it('категория 0 не имеет delivery_status (нет накладной)', () => {
    expect(categoryToDeliveryStatus(0)).toBeNull();
  });
});

describe('cdek/status-map — категория → delivery_status', () => {
  it('маппинг категорий 1–5', () => {
    expect(categoryToDeliveryStatus(1)).toBe('registered');
    expect(categoryToDeliveryStatus(2)).toBe('in_transit');
    expect(categoryToDeliveryStatus(3)).toBe('in_transit');
    expect(categoryToDeliveryStatus(4)).toBe('delivered');
    // 5 без кода трактуется как returned по умолчанию (проблема)
    expect(categoryToDeliveryStatus(5)).toBe('returned');
  });

  it('спец-кейсы категории 5 → cancelled: REMOVED (СДЭК) и CANCELLED (внутренний sentinel)', () => {
    expect(categorize('REMOVED')).toBe(5);
    expect(mapCdekStatus('REMOVED')).toBe('cancelled');
    // CANCELLED не приходит от СДЭК (нет в Приложении 1); его ставит наш
    // cancelShipment в cdek_shipments.status_code — оставлен как внутренний код.
    expect(categorize('CANCELLED')).toBe(5);
    expect(mapCdekStatus('CANCELLED')).toBe('cancelled');
  });
});

describe('cdek/status-map — displayName и шаблоны писем', () => {
  it('displayName известного кода — русское имя (по Приложению 1)', () => {
    expect(displayName('DELIVERED')).toBe('Вручён');
    expect(displayName('CREATED')).toBe('Создан');
    expect(displayName('REMOVED')).toBe('Удалён');
    expect(Object.keys(STATUS_TO_NAME)).toContain('DELIVERED');
  });

  it('displayName неизвестного кода — сам код', () => {
    expect(displayName('WEIRD')).toBe('WEIRD');
  });

  it('displayName внутреннего sentinel NOT_FOUND (заказ удалён/не найден в СДЭК)', () => {
    expect(displayName('NOT_FOUND')).toBe('Не найден в СДЭК');
  });

  it('clientEmailTemplate — шаблон или null', () => {
    expect(clientEmailTemplate('DELIVERED')).toBe('cdek_delivered');
    expect(clientEmailTemplate('POSTOMAT_RECEIVED')).toBe('cdek_delivered');
    expect(clientEmailTemplate('ACCEPTED_AT_PICK_UP_POINT')).toBe('cdek_ready_for_pickup');
    expect(clientEmailTemplate('ENTERED_TO_PICK_UP_POINT')).toBe('cdek_ready_for_pickup');
    expect(clientEmailTemplate('POSTOMAT_POSTED')).toBe('cdek_ready_for_pickup');
    expect(clientEmailTemplate('TAKEN_BY_COURIER')).toBe('cdek_courier_dispatched');
    // CREATED — технический, без письма
    expect(clientEmailTemplate('CREATED')).toBeNull();
    expect(clientEmailTemplate('NOPE')).toBeNull();
    // легаси-код удалён вместе с таблицей категорий
    expect(clientEmailTemplate('READY_FOR_PICKUP')).toBeNull();
  });

  it('adminEmailTemplate — cdek_problem для проблемных кодов', () => {
    expect(adminEmailTemplate('NOT_DELIVERED')).toBe('cdek_problem');
    expect(adminEmailTemplate('POSTOMAT_SEIZED')).toBe('cdek_problem');
    expect(adminEmailTemplate('REMOVED')).toBe('cdek_problem');
    expect(adminEmailTemplate('CANCELLED')).toBe('cdek_problem');
    expect(adminEmailTemplate('INVALID')).toBe('cdek_problem');
    expect(adminEmailTemplate('DELIVERED')).toBeNull();
    expect(adminEmailTemplate('NOPE')).toBeNull();
  });
});
