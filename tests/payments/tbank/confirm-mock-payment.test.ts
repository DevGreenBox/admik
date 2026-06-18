import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Юнит-тесты confirmMockPayment (волна 9): demo-подтверждение mock-платежа со
 * стенда без боевых ключей. КЛЮЧЕВОЕ — строгий mock-gate: в боевом режиме (заданы
 * TBANK_*) метод РЕФЬЮЗИТ (никакого обхода реальной оплаты). БД/orders-репозиторий
 * замоканы (как в webhook.test).
 */

const recordWebhookEventMock = vi.fn((..._a: unknown[]) =>
  Promise.resolve({ inserted: true, processed: true }),
);
const setPaymentRefAndProviderMock = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock('@/lib/payments/tbank/repository', () => ({
  recordWebhookEvent: (...a: unknown[]) => recordWebhookEventMock(...a),
  setPaymentRefAndProvider: (...a: unknown[]) => setPaymentRefAndProviderMock(...a),
}));

const getOrderByNumberMock = vi.fn();
vi.mock('@/lib/orders/repository', () => ({
  getOrderByNumber: (...a: unknown[]) => getOrderByNumberMock(...a),
}));

import { TbankManager } from '@/lib/payments/tbank/manager';
import { getTbankConfig } from '@/lib/payments/tbank/config';
import { PaymentService } from '@/lib/payments/tbank/service';

const MOCK_CFG = getTbankConfig({ NODE_ENV: 'test' }); // нет ключей → isMock=true
const REAL_CFG = getTbankConfig({ NODE_ENV: 'test', TBANK_TERMINAL_KEY: 'tk', TBANK_PASSWORD: 'pw' });

function svc(cfg: typeof MOCK_CFG): PaymentService {
  return new PaymentService(new TbankManager({ config: cfg }));
}

const ORDER = { order: { id: 'ord-uuid-1', number: '2026-000777', grandTotal: '1990.00' }, items: [] };

beforeEach(() => {
  recordWebhookEventMock.mockClear();
  setPaymentRefAndProviderMock.mockClear();
  getOrderByNumberMock.mockReset();
});

describe('confirmMockPayment — mock-gate', () => {
  it('БОЕВОЙ режим (заданы ключи) → РЕФЬЮЗ, статус НЕ применяется', async () => {
    const r = await svc(REAL_CFG).confirmMockPayment('2026-000777', '900000001');
    expect(r).toEqual({ ok: false, reason: 'not_mock' });
    expect(recordWebhookEventMock).not.toHaveBeenCalled();
    expect(getOrderByNumberMock).not.toHaveBeenCalled();
  });

  it('пустой orderNumber/paymentId → bad_request', async () => {
    expect(await svc(MOCK_CFG).confirmMockPayment('', 'p')).toEqual({ ok: false, reason: 'bad_request' });
    expect(await svc(MOCK_CFG).confirmMockPayment('o', '')).toEqual({ ok: false, reason: 'bad_request' });
    expect(recordWebhookEventMock).not.toHaveBeenCalled();
  });

  it('mock + заказ не найден → order_not_found, статус НЕ применяется', async () => {
    getOrderByNumberMock.mockResolvedValue(null);
    const r = await svc(MOCK_CFG).confirmMockPayment('2026-000777', '900000001');
    expect(r).toEqual({ ok: false, reason: 'order_not_found' });
    expect(recordWebhookEventMock).not.toHaveBeenCalled();
  });

  it('mock + заказ найден → ok, recordWebhookEvent(nextStatus=paid, CONFIRMED)', async () => {
    getOrderByNumberMock.mockResolvedValue(ORDER);
    const r = await svc(MOCK_CFG).confirmMockPayment('2026-000777', '900000001');
    expect(r).toEqual({ ok: true });
    expect(recordWebhookEventMock).toHaveBeenCalledTimes(1);
    const arg = recordWebhookEventMock.mock.calls[0]![0] as {
      log: { orderId: string; paymentId: string; status: string; isMock: boolean };
      nextStatus: string | null;
    };
    expect(arg.log.orderId).toBe('ord-uuid-1');
    expect(arg.log.paymentId).toBe('900000001');
    expect(arg.log.status).toBe('CONFIRMED');
    expect(arg.log.isMock).toBe(true);
    expect(arg.nextStatus).toBe('paid');
  });
});
