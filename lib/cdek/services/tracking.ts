/**
 * TrackingService — pull статусов отправления (docs/08 §7.2, порт логики
 * actionSyncOrder carre).
 *
 * Выбор источника — по manager.isMock:
 *   • mock → mockTrackStatuses (детерминированная цепочка happy-path);
 *   • real → GET /v2/orders/{uuid} → entity.statuses[] + entity.cdek_number.
 *
 * Берём ПОСЛЕДНИЙ (актуальный) НЕотозванный статус (deleted=true отбрасывается —
 * СДЭК может отозвать ошибочно проставленный финальный статус), маппим через
 * status-map.mapCdekStatus, обновляем cdek_shipments.status_* и
 * orders.delivery_status (через advanceDeliveryStatus — докручивает цепь ПО ШАГАМ
 * до актуального статуса, чтобы прыжок registered→delivered при потерянном
 * in_transit не дропался молча, C4-2).
 *
 * Боевой режим дополнительно:
 *   • backfill cdek_number: POST /v2/orders НЕ возвращает трек-номер (он
 *     присваивается позже) — синк подхватывает entity.cdek_number и обновляет
 *     cdek_shipments.cdek_number + денормализованный orders.cdek_track;
 *   • v2_entity_not_found / v2_entity_forbidden (заказ не существует / удалён /
 *     старше 1 года / чужой): финальная пометка statusCode='NOT_FOUND' + error,
 *     БЕЗ throw — иначе refresh-active ретраил бы такой заказ вечно (голодание
 *     очереди). findActiveShipments исключает NOT_FOUND из выборки.
 *
 * БД-зависимое → интеграционные тесты (skipIf); маппинг/выбор последнего статуса/
 * детект финальной ошибки — чистые тестируемые функции.
 */

import type { CdekManager } from '../manager';
import { getCdekManager } from '../manager';
import { CdekError } from '../errors';
import {
  getShipmentByOrderId,
  getShipmentByCdekUuid,
  updateShipmentByOrderId,
  setOrderCdekTrack,
} from '../repository';
import { mapCdekStatus, displayName } from './status-map';
import { advanceDeliveryStatus } from './delivery-status';
import type { CdekShipment } from '../types';

/** Один статус трекинга (нормализованный). */
export interface TrackStatus {
  code: string;
  name: string;
  dateTime: Date | null;
}

/** Нормализованный ответ GET /v2/orders/{uuid} (нужное трекингу подмножество). */
export interface TrackOrderInfo {
  /** Статусы БЕЗ отозванных (deleted=true). */
  statuses: TrackStatus[];
  /** Трек-номер СДЭК (entity.cdek_number); null, если ещё не присвоен. */
  cdekNumber: string | null;
}

/**
 * Внутренний sentinel-код cdek_shipments.status_code: заказ не существует /
 * удалён / старше 1 года / чужой (v2_entity_not_found / v2_entity_forbidden).
 * Финальный: findActiveShipments (lib/cdek/cron.ts) исключает его из pull-опроса.
 */
export const TRACKING_NOT_FOUND_STATUS = 'NOT_FOUND';

/** Результат обновления статуса. */
export interface RefreshResult {
  /** Последний код статуса СДЭК (или null, если статусов нет). */
  statusCode: string | null;
  /** Применённый delivery_status (если переход прошёл) или null. */
  appliedDeliveryStatus: string | null;
  transitioned: boolean;
}

/** Парсит дату СДЭК (ISO8601) в Date или null. */
function parseDateTime(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Нормализует ответ GET /v2/orders/{uuid} → TrackOrderInfo (чистая):
 * entity.statuses[] без отозванных (deleted=true — по спеке СДЭК бывает только у
 * финальных статусов: применить его как актуальный значило бы ложный финал) +
 * entity.cdek_number (трек, присваивается ПОЗЖЕ создания заказа).
 */
export function parseOrderInfo(raw: unknown): TrackOrderInfo {
  const entity = (raw as { entity?: { statuses?: unknown; cdek_number?: unknown } } | undefined)
    ?.entity;
  const arr = Array.isArray(entity?.statuses) ? (entity!.statuses as Record<string, unknown>[]) : [];
  const statuses = arr
    .filter((s) => s.deleted !== true)
    .map((s) => ({
      code: String(s.code ?? ''),
      name: typeof s.name === 'string' ? s.name : displayName(String(s.code ?? '')),
      dateTime: parseDateTime(s.date_time ?? s.dateTime),
    }));
  const num = entity?.cdek_number;
  return {
    statuses,
    cdekNumber: typeof num === 'string' && num.length > 0 ? num : null,
  };
}

/**
 * Нормализует entity.statuses[] ответа СДЭК → TrackStatus[] (чистая, совместимый
 * фасад над parseOrderInfo). Отозванные статусы (deleted=true) отброшены.
 */
export function parseStatuses(raw: unknown): TrackStatus[] {
  return parseOrderInfo(raw).statuses;
}

/**
 * Выбирает актуальный статус из списка (чистая): по максимальной дате, при
 * отсутствии дат — последний в массиве. null для пустого списка.
 */
export function latestStatus(statuses: readonly TrackStatus[]): TrackStatus | null {
  if (statuses.length === 0) return null;
  const withDates = statuses.filter((s) => s.dateTime !== null);
  if (withDates.length > 0) {
    return withDates.reduce((a, b) =>
      (b.dateTime!.getTime() >= a.dateTime!.getTime() ? b : a),
    );
  }
  return statuses[statuses.length - 1]!;
}

/**
 * Финальная ошибка «сущности нет» (чистая): CdekError с кодом (или cdekErrors[]
 * из тела ответа СДЭК) v2_entity_not_found / v2_entity_forbidden — заказ не
 * существует, удалён, старше 1 года (СДЭК хранит 1 год) либо принадлежит другому
 * договору. Ретраить бессмысленно — отправление надо пометить финально.
 */
export function isEntityGoneError(err: unknown): boolean {
  if (!(err instanceof CdekError)) return false;
  const GONE = ['v2_entity_not_found', 'v2_entity_forbidden'];
  if (GONE.includes(err.code)) return true;
  return err.cdekErrors.some((e) => GONE.includes(e.code));
}

export class TrackingService {
  constructor(private readonly manager: CdekManager = getCdekManager()) {}

  /**
   * Запрашивает заказ по uuid отправления (mock/real), нормализует статусы
   * (без deleted) + cdek_number. В mock-режиме трек уже присвоен при создании
   * (mockCreateShipment) → cdekNumber=null (backfill не нужен).
   */
  async fetchOrderInfo(cdekUuid: string): Promise<TrackOrderInfo> {
    if (this.manager.isMock) {
      return {
        statuses: this.manager.mock.mockTrackStatuses().map((s) => ({
          code: s.code,
          name: s.name,
          dateTime: parseDateTime(s.dateTime),
        })),
        cdekNumber: null,
      };
    }
    const raw = await this.manager.client.request<Record<string, unknown>>(
      'GET',
      `/v2/orders/${cdekUuid}`,
    );
    return parseOrderInfo(raw);
  }

  /** Запрашивает статусы по uuid отправления (mock/real), нормализует. */
  async fetchStatuses(cdekUuid: string): Promise<TrackStatus[]> {
    return (await this.fetchOrderInfo(cdekUuid)).statuses;
  }

  /**
   * Обновляет статус заказа по его id: грузит отправление, тянет статусы из СДЭК,
   * берёт актуальный, обновляет cdek_shipments + delivery_status (через статус-
   * машину). Возвращает что применилось.
   */
  async refreshStatus(orderId: string): Promise<RefreshResult> {
    const shipment = await getShipmentByOrderId(orderId);
    if (!shipment?.cdekUuid) {
      throw new CdekError(
        'cdek_no_shipment',
        `Для заказа ${orderId} нет отправления (cdek_uuid) для трекинга.`,
      );
    }
    return this.applyFromUuid(orderId, shipment.cdekUuid, shipment.cdekNumber ?? null);
  }

  /** Обновляет статус заказа по cdek_uuid (находит заказ через shipment). */
  async refreshByCdekUuid(cdekUuid: string): Promise<RefreshResult> {
    const shipment: CdekShipment | null = await getShipmentByCdekUuid(cdekUuid);
    if (!shipment) {
      throw new CdekError('cdek_no_shipment', `Отправление с uuid ${cdekUuid} не найдено.`);
    }
    return this.applyFromUuid(shipment.orderId, cdekUuid, shipment.cdekNumber ?? null);
  }

  private async applyFromUuid(
    orderId: string,
    cdekUuid: string,
    savedCdekNumber: string | null,
  ): Promise<RefreshResult> {
    let info: TrackOrderInfo;
    try {
      info = await this.fetchOrderInfo(cdekUuid);
    } catch (err) {
      if (isEntityGoneError(err)) {
        // Заказ не существует/удалён/старше года/чужой — финальная пометка, чтобы
        // refresh-active перестал опрашивать (иначе вечный ретрай = голодание очереди).
        await this.markShipmentGone(orderId, err as CdekError);
        return {
          statusCode: TRACKING_NOT_FOUND_STATUS,
          appliedDeliveryStatus: null,
          transitioned: false,
        };
      }
      throw err; // транзиент (сеть/5xx) — пусть ретраит следующий тик
    }

    // Backfill трек-номера (боевой режим): create() его не получает (СДЭК
    // присваивает позже) — подхватываем из GET и денормализуем на orders.
    const newTrack =
      info.cdekNumber && info.cdekNumber !== savedCdekNumber ? info.cdekNumber : null;
    if (newTrack) {
      await setOrderCdekTrack(orderId, newTrack);
    }

    const latest = latestStatus(info.statuses);
    if (!latest) {
      if (newTrack) {
        await updateShipmentByOrderId(orderId, { cdekNumber: newTrack });
      }
      return { statusCode: null, appliedDeliveryStatus: null, transitioned: false };
    }

    await updateShipmentByOrderId(orderId, {
      // COALESCE-патч репозитория: null → не менять (трек не изменился).
      cdekNumber: newTrack,
      statusCode: latest.code,
      statusName: latest.name || displayName(latest.code),
      statusAt: latest.dateTime ?? new Date(),
    });

    const next = mapCdekStatus(latest.code);
    let transitioned = false;
    if (next) {
      transitioned = await advanceDeliveryStatus(orderId, next, `cdek:${latest.code}`);
    }

    return {
      statusCode: latest.code,
      appliedDeliveryStatus: transitioned ? next : null,
      transitioned,
    };
  }

  /** Помечает отправление финальной ошибкой «нет в СДЭК» (без throw). */
  private async markShipmentGone(orderId: string, err: CdekError): Promise<void> {
    const codes = err.cdekErrors.map((e) => e.code).join(', ') || err.code;
    console.warn(
      `[cdek/tracking] заказ ${orderId}: сущность недоступна в СДЭК (${codes}) — ` +
        `отправление помечено ${TRACKING_NOT_FOUND_STATUS}, опрос прекращён.`,
    );
    await updateShipmentByOrderId(orderId, {
      statusCode: TRACKING_NOT_FOUND_STATUS,
      statusName: displayName(TRACKING_NOT_FOUND_STATUS),
      statusAt: new Date(),
      error: `Трекинг остановлен: ${codes} — ${err.message}`,
    });
  }
}
