import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Тесты TrackingService (docs/08 §7.2).
 *
 * (а) ЧИСТЫЕ — parseStatuses / parseOrderInfo / latestStatus / isEntityGoneError.
 *     Без сети/БД.
 * (б) refreshStatus — мокаем repository + advanceDeliveryStatus. Проверяем:
 *     маппинг статуса → delivery_status, недопустимый переход не применяется,
 *     backfill cdek_number (боевой режим: трек приходит ПОЗЖЕ создания заказа),
 *     обработку v2_entity_not_found/v2_entity_forbidden (финальная пометка
 *     NOT_FOUND вместо вечного ретрая — голодание очереди refresh-active).
 */

type ShipmentLookup = { orderId: string; cdekUuid: string; cdekNumber?: string | null } | null;
const getShipmentMock = vi.fn(
  async (): Promise<ShipmentLookup> => ({ orderId: 'ord-1', cdekUuid: 'u-1', cdekNumber: null }),
);
const updateShipmentMock = vi.fn(async () => null);
const setOrderCdekTrackMock = vi.fn(async () => undefined);
vi.mock('@/lib/cdek/repository', () => ({
  getShipmentByOrderId: (...a: unknown[]) => getShipmentMock(...(a as [])),
  getShipmentByCdekUuid: (...a: unknown[]) => getShipmentMock(...(a as [])),
  updateShipmentByOrderId: (...a: unknown[]) => updateShipmentMock(...(a as [])),
  setOrderCdekTrack: (...a: unknown[]) => setOrderCdekTrackMock(...(a as [])),
}));

// C4-2: tracking докручивает delivery_status до актуального статуса СДЭК через
// advanceDeliveryStatus (пошагово по канонической цепи), а не одношагово.
const advanceDeliveryStatusMock = vi.fn(async () => true);
vi.mock('@/lib/cdek/services/delivery-status', () => ({
  advanceDeliveryStatus: (...a: unknown[]) => advanceDeliveryStatusMock(...(a as [])),
}));

import {
  TrackingService,
  parseStatuses,
  parseOrderInfo,
  latestStatus,
  isEntityGoneError,
  TRACKING_NOT_FOUND_STATUS,
  type TrackStatus,
} from '@/lib/cdek/services/tracking';
import { CdekManager } from '@/lib/cdek/manager';
import { CdekError } from '@/lib/cdek/errors';
import { getCdekConfig } from '@/lib/cdek/config';
import { mockTrackStatuses } from '@/lib/cdek/mock';
import { mapCdekStatus } from '@/lib/cdek/services/status-map';

const mockCfg = getCdekConfig({ NODE_ENV: 'test' });

/** Стаб «боевого» менеджера: isMock=false, client.request — vi.fn. */
function realManagerStub(request: (...a: unknown[]) => Promise<unknown>): CdekManager {
  return { isMock: false, client: { request } } as unknown as CdekManager;
}

describe('cdek/tracking — parseStatuses / parseOrderInfo / latestStatus (чистые)', () => {
  it('parseStatuses нормализует entity.statuses[]', () => {
    const out = parseStatuses({
      entity: {
        statuses: [
          { code: 'CREATED', name: 'Создан', date_time: '2026-06-15T10:00:00+0300' },
          { code: 'DELIVERED', name: 'Вручён', date_time: '2026-06-18T15:00:00+0300' },
        ],
      },
    });
    expect(out).toHaveLength(2);
    expect(out[1].code).toBe('DELIVERED');
    expect(out[1].dateTime).toBeInstanceOf(Date);
  });

  it('parseStatuses отбрасывает отозванные статусы (deleted=true)', () => {
    const out = parseStatuses({
      entity: {
        statuses: [
          { code: 'CREATED', date_time: '2026-06-15T10:00:00+0300', deleted: false },
          { code: 'DELIVERED', date_time: '2026-06-18T15:00:00+0300', deleted: true },
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('CREATED');
  });

  it('parseOrderInfo возвращает cdek_number и статусы (без deleted)', () => {
    const info = parseOrderInfo({
      entity: {
        cdek_number: '1105973031',
        statuses: [
          { code: 'CREATED', date_time: '2026-06-15T10:00:00+0300' },
          { code: 'REMOVED', date_time: '2026-06-16T10:00:00+0300', deleted: true },
        ],
      },
    });
    expect(info.cdekNumber).toBe('1105973031');
    expect(info.statuses).toHaveLength(1);
    expect(info.statuses[0].code).toBe('CREATED');
  });

  it('parseOrderInfo: нет cdek_number (ещё не присвоен) → null', () => {
    const info = parseOrderInfo({ entity: { statuses: [] } });
    expect(info.cdekNumber).toBeNull();
    expect(info.statuses).toEqual([]);
  });

  it('latestStatus берёт по максимальной дате', () => {
    const statuses: TrackStatus[] = [
      { code: 'CREATED', name: 'a', dateTime: new Date('2026-06-15T10:00:00Z') },
      { code: 'DELIVERED', name: 'b', dateTime: new Date('2026-06-18T15:00:00Z') },
      { code: 'ON_THE_WAY', name: 'c', dateTime: new Date('2026-06-16T08:00:00Z') },
    ];
    expect(latestStatus(statuses)?.code).toBe('DELIVERED');
  });

  it('latestStatus без дат → последний в массиве', () => {
    const statuses: TrackStatus[] = [
      { code: 'A', name: '', dateTime: null },
      { code: 'B', name: '', dateTime: null },
    ];
    expect(latestStatus(statuses)?.code).toBe('B');
  });

  it('пустой список → null', () => {
    expect(latestStatus([])).toBeNull();
  });
});

describe('cdek/tracking — isEntityGoneError (чистая)', () => {
  it('true для cdekErrors[].code = v2_entity_not_found / v2_entity_forbidden', () => {
    expect(
      isEntityGoneError(
        new CdekError('cdek_http_error', 'x', {
          cdekErrors: [{ code: 'v2_entity_not_found', message: 'не найден' }],
          httpStatus: 400,
        }),
      ),
    ).toBe(true);
    expect(
      isEntityGoneError(
        new CdekError('cdek_http_error', 'x', {
          cdekErrors: [{ code: 'v2_entity_forbidden', message: 'чужой заказ' }],
        }),
      ),
    ).toBe(true);
  });

  it('true, если сам code CdekError — v2_entity_not_found', () => {
    expect(isEntityGoneError(new CdekError('v2_entity_not_found', 'x'))).toBe(true);
  });

  it('false для прочих ошибок (сетевые/5xx/не-CdekError)', () => {
    expect(isEntityGoneError(new CdekError('cdek_network_error', 'boom'))).toBe(false);
    expect(
      isEntityGoneError(
        new CdekError('cdek_http_error', 'x', {
          cdekErrors: [{ code: 'v2_internal_error', message: 'oops' }],
          httpStatus: 500,
        }),
      ),
    ).toBe(false);
    expect(isEntityGoneError(new Error('plain'))).toBe(false);
    expect(isEntityGoneError(null)).toBe(false);
  });
});

describe('cdek/tracking — mock-цепочка согласована с маппингом', () => {
  it('каждый код mockTrackStatuses() замаплен (не null) — happy-path без дыр', () => {
    for (const s of mockTrackStatuses()) {
      expect(mapCdekStatus(s.code), `код ${s.code} должен быть в STATUS_TO_CATEGORY`).not.toBeNull();
    }
  });
});

describe('cdek/tracking — refreshStatus (mock-трекинг)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getShipmentMock.mockResolvedValue({ orderId: 'ord-1', cdekUuid: 'u-1', cdekNumber: null });
  });

  it('mock: берёт последний статус (DELIVERED) → докручивает до delivered', async () => {
    advanceDeliveryStatusMock.mockResolvedValue(true);
    const svc = new TrackingService(new CdekManager({ config: mockCfg }));
    const r = await svc.refreshStatus('ord-1');
    expect(r.statusCode).toBe('DELIVERED'); // последний в mockTrackStatuses
    expect(r.transitioned).toBe(true);
    expect(advanceDeliveryStatusMock).toHaveBeenCalledWith('ord-1', 'delivered', expect.any(String));
    expect(updateShipmentMock).toHaveBeenCalled();
  });

  it('нет применённого перехода (уже в целевом) → advanceDeliveryStatus=false → transitioned=false', async () => {
    advanceDeliveryStatusMock.mockResolvedValue(false);
    const svc = new TrackingService(new CdekManager({ config: mockCfg }));
    const r = await svc.refreshStatus('ord-1');
    expect(r.transitioned).toBe(false);
    expect(r.appliedDeliveryStatus).toBeNull();
    // но снимок статуса отправления всё равно обновлён
    expect(updateShipmentMock).toHaveBeenCalled();
  });

  it('нет отправления (cdek_uuid) → ошибка', async () => {
    getShipmentMock.mockResolvedValue(null);
    const svc = new TrackingService(new CdekManager({ config: mockCfg }));
    await expect(svc.refreshStatus('ord-1')).rejects.toThrow();
  });
});

describe('cdek/tracking — боевой режим: backfill cdek_number', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getShipmentMock.mockResolvedValue({ orderId: 'ord-1', cdekUuid: 'u-1', cdekNumber: null });
  });

  it('entity.cdek_number появился → обновляет cdek_shipments.cdek_number и orders.cdek_track', async () => {
    const request = vi.fn(async () => ({
      entity: {
        cdek_number: '1105973031',
        statuses: [{ code: 'RECEIVED_AT_SHIPMENT_WAREHOUSE', date_time: '2026-07-01T10:00:00+0300' }],
      },
    }));
    const svc = new TrackingService(realManagerStub(request));
    const r = await svc.refreshStatus('ord-1');

    expect(request).toHaveBeenCalledWith('GET', '/v2/orders/u-1');
    expect(setOrderCdekTrackMock).toHaveBeenCalledWith('ord-1', '1105973031');
    expect(updateShipmentMock).toHaveBeenCalledWith(
      'ord-1',
      expect.objectContaining({ cdekNumber: '1105973031', statusCode: 'RECEIVED_AT_SHIPMENT_WAREHOUSE' }),
    );
    expect(r.statusCode).toBe('RECEIVED_AT_SHIPMENT_WAREHOUSE');
    expect(advanceDeliveryStatusMock).toHaveBeenCalledWith('ord-1', 'in_transit', 'cdek:RECEIVED_AT_SHIPMENT_WAREHOUSE');
  });

  it('cdek_number не изменился → orders.cdek_track НЕ трогаем', async () => {
    getShipmentMock.mockResolvedValue({ orderId: 'ord-1', cdekUuid: 'u-1', cdekNumber: '1105973031' });
    const request = vi.fn(async () => ({
      entity: {
        cdek_number: '1105973031',
        statuses: [{ code: 'DELIVERED', date_time: '2026-07-02T10:00:00+0300' }],
      },
    }));
    const svc = new TrackingService(realManagerStub(request));
    await svc.refreshStatus('ord-1');
    expect(setOrderCdekTrackMock).not.toHaveBeenCalled();
    // COALESCE-патч: cdekNumber не передаётся (null/отсутствует) — не затирается
    const patch = (updateShipmentMock.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(patch.cdekNumber ?? null).toBeNull();
  });

  it('cdek_number есть, статусов ещё нет → backfill всё равно выполняется', async () => {
    const request = vi.fn(async () => ({
      entity: { cdek_number: '1105973031', statuses: [] },
    }));
    const svc = new TrackingService(realManagerStub(request));
    const r = await svc.refreshStatus('ord-1');
    expect(setOrderCdekTrackMock).toHaveBeenCalledWith('ord-1', '1105973031');
    expect(updateShipmentMock).toHaveBeenCalledWith(
      'ord-1',
      expect.objectContaining({ cdekNumber: '1105973031' }),
    );
    expect(r.statusCode).toBeNull();
    expect(r.transitioned).toBe(false);
    expect(advanceDeliveryStatusMock).not.toHaveBeenCalled();
  });

  it('deleted=true статус НЕ применяется как актуальный', async () => {
    const request = vi.fn(async () => ({
      entity: {
        cdek_number: '1105973031',
        statuses: [
          { code: 'RECEIVED_AT_SHIPMENT_WAREHOUSE', date_time: '2026-07-01T10:00:00+0300' },
          { code: 'DELIVERED', date_time: '2026-07-02T10:00:00+0300', deleted: true },
        ],
      },
    }));
    const svc = new TrackingService(realManagerStub(request));
    const r = await svc.refreshStatus('ord-1');
    expect(r.statusCode).toBe('RECEIVED_AT_SHIPMENT_WAREHOUSE');
    expect(advanceDeliveryStatusMock).toHaveBeenCalledWith('ord-1', 'in_transit', expect.any(String));
  });

  it('REMOVED (удалён на стороне СДЭК) → докрутка до cancelled', async () => {
    const request = vi.fn(async () => ({
      entity: {
        statuses: [
          { code: 'CREATED', date_time: '2026-07-01T10:00:00+0300' },
          { code: 'REMOVED', date_time: '2026-07-02T10:00:00+0300' },
        ],
      },
    }));
    const svc = new TrackingService(realManagerStub(request));
    const r = await svc.refreshStatus('ord-1');
    expect(r.statusCode).toBe('REMOVED');
    expect(advanceDeliveryStatusMock).toHaveBeenCalledWith('ord-1', 'cancelled', 'cdek:REMOVED');
  });
});

describe('cdek/tracking — боевой режим: v2_entity_not_found / v2_entity_forbidden', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getShipmentMock.mockResolvedValue({ orderId: 'ord-1', cdekUuid: 'u-1', cdekNumber: null });
  });

  it('v2_entity_not_found → финальная пометка NOT_FOUND без throw (не ретраим вечно)', async () => {
    const request = vi.fn(async () => {
      throw new CdekError('cdek_http_error', 'Запрошенный заказ не найден', {
        cdekErrors: [{ code: 'v2_entity_not_found', message: 'не найден' }],
        httpStatus: 400,
      });
    });
    const svc = new TrackingService(realManagerStub(request));
    const r = await svc.refreshStatus('ord-1');
    expect(r.statusCode).toBe(TRACKING_NOT_FOUND_STATUS);
    expect(r.transitioned).toBe(false);
    expect(r.appliedDeliveryStatus).toBeNull();
    expect(updateShipmentMock).toHaveBeenCalledWith(
      'ord-1',
      expect.objectContaining({
        statusCode: TRACKING_NOT_FOUND_STATUS,
        error: expect.stringContaining('v2_entity_not_found'),
      }),
    );
    expect(advanceDeliveryStatusMock).not.toHaveBeenCalled();
  });

  it('v2_entity_forbidden → та же финальная пометка', async () => {
    const request = vi.fn(async () => {
      throw new CdekError('cdek_http_error', 'Чужой заказ', {
        cdekErrors: [{ code: 'v2_entity_forbidden', message: 'forbidden' }],
        httpStatus: 403,
      });
    });
    const svc = new TrackingService(realManagerStub(request));
    const r = await svc.refreshStatus('ord-1');
    expect(r.statusCode).toBe(TRACKING_NOT_FOUND_STATUS);
    expect(updateShipmentMock).toHaveBeenCalledWith(
      'ord-1',
      expect.objectContaining({ statusCode: TRACKING_NOT_FOUND_STATUS }),
    );
  });

  it('прочие ошибки СДЭК пробрасываются (транзиент — ретрай следующим тиком)', async () => {
    const request = vi.fn(async () => {
      throw new CdekError('cdek_network_error', 'сбой сети');
    });
    const svc = new TrackingService(realManagerStub(request));
    await expect(svc.refreshStatus('ord-1')).rejects.toThrow('сбой сети');
    expect(updateShipmentMock).not.toHaveBeenCalled();
  });
});
