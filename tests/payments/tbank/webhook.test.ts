import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Юнит-тесты обработки webhook Т-Банка (docs/15 §4.2, §7). БД и orders-репозиторий
 * замоканы — проверяем связку проверки Token + идемпотентности + маппинга статуса
 * БЕЗ живой БД (репозиторий-зависимое — под мок, как webhook-route.test СДЭК).
 *
 * Проверяется:
 *   • невалидный Token → verified:false, лог НЕ пишется, переход НЕ применяется;
 *   • валидный Token + CONFIRMED → applyPaymentStatus('paid') вызывается, processed:true;
 *   • дубликат (insertPaymentLog → inserted:false) → duplicate:true, переход НЕ повторяется;
 *   • заказ не найден → processed:false без падения;
 *   • parseNotification/sanitizeNotification — чистые.
 */

import { signToken } from '@/lib/payments/tbank/token';

const PASSWORD = 'webhook-test-pw';

// --- Моки репозиториев (без БД) ---
// Rest-сигнатуры (...a: unknown[]), чтобы обёртки в vi.mock могли спредить
// аргументы внутрь (иначе TS2556 — спред в функцию без rest-параметра).
const insertPaymentLogMock = vi.fn();
const markPaymentLogProcessedMock = vi.fn((..._a: unknown[]) => Promise.resolve());
const applyPaymentStatusMock = vi.fn((..._a: unknown[]) => Promise.resolve(true));
const setPaymentRefAndProviderMock = vi.fn((..._a: unknown[]) => Promise.resolve());

vi.mock('@/lib/payments/tbank/repository', () => ({
  insertPaymentLog: (...a: unknown[]) => insertPaymentLogMock(...a),
  markPaymentLogProcessed: (...a: unknown[]) => markPaymentLogProcessedMock(...a),
  applyPaymentStatus: (...a: unknown[]) => applyPaymentStatusMock(...a),
  setPaymentRefAndProvider: (...a: unknown[]) => setPaymentRefAndProviderMock(...a),
}));

const getOrderByNumberMock = vi.fn();
vi.mock('@/lib/orders/repository', () => ({
  getOrderByNumber: (...a: unknown[]) => getOrderByNumberMock(...a),
}));

// Менеджер с боевым config (password задан → verify работает), но fetch не дёргается
// (webhook не ходит в сеть). isMock=false, чтобы password присутствовал.
import { TbankManager } from '@/lib/payments/tbank/manager';
import { getTbankConfig } from '@/lib/payments/tbank/config';
import {
  PaymentService,
  parseNotification,
  sanitizeNotification,
} from '@/lib/payments/tbank/service';

const CFG = getTbankConfig({
  NODE_ENV: 'test',
  TBANK_TERMINAL_KEY: 'tk',
  TBANK_PASSWORD: PASSWORD,
});

function service(): PaymentService {
  return new PaymentService(new TbankManager({ config: CFG }));
}

function signedBody(extra: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    TerminalKey: 'tk',
    OrderId: '2026-000123',
    Success: true,
    PaymentId: '900000001',
    Amount: 150000,
    ...extra,
  };
  body.Token = signToken(body, PASSWORD);
  return body;
}

beforeEach(() => {
  insertPaymentLogMock.mockReset();
  insertPaymentLogMock.mockResolvedValue({ inserted: true, id: 'log-1' });
  markPaymentLogProcessedMock.mockClear();
  applyPaymentStatusMock.mockReset();
  applyPaymentStatusMock.mockResolvedValue(true);
  getOrderByNumberMock.mockReset();
  getOrderByNumberMock.mockResolvedValue({ order: { id: 'order-uuid-1' }, items: [] });
});

describe('tbank/service — parseNotification / sanitizeNotification (чистые)', () => {
  it('нормализует OrderId/PaymentId/Status/Amount/Token', () => {
    const ev = parseNotification({
      OrderId: '2026-000123',
      PaymentId: 900000001, // число → строка
      Status: 'CONFIRMED',
      Amount: 150000,
      Token: 'abc',
    });
    expect(ev.orderNumber).toBe('2026-000123');
    expect(ev.paymentId).toBe('900000001');
    expect(ev.status).toBe('CONFIRMED');
    expect(ev.amountKop).toBe(150000);
    expect(ev.token).toBe('abc');
  });

  it('невалидный объект → null-поля', () => {
    const ev = parseNotification(null);
    expect(ev.paymentId).toBeNull();
    expect(ev.status).toBeNull();
  });

  it('sanitizeNotification убирает Token/Pan/CardId', () => {
    const clean = sanitizeNotification({
      OrderId: 'x',
      Token: 'secret',
      Pan: '4300********0777',
      CardId: '12345',
      Status: 'NEW',
    });
    expect(clean).toEqual({ OrderId: 'x', Status: 'NEW' });
  });
});

describe('tbank/service — handleWebhook проверка Token', () => {
  it('невалидный Token → verified:false, лог не пишется, переход не применяется', async () => {
    const body = signedBody({ Status: 'CONFIRMED' });
    body.Token = 'tampered';
    const res = await service().handleWebhook(body);
    expect(res.verified).toBe(false);
    expect(insertPaymentLogMock).not.toHaveBeenCalled();
    expect(applyPaymentStatusMock).not.toHaveBeenCalled();
  });

  it('подмена суммы после подписи ломает Token (anti-tamper)', async () => {
    const body = signedBody({ Status: 'CONFIRMED' });
    body.Amount = 1;
    const res = await service().handleWebhook(body);
    expect(res.verified).toBe(false);
  });
});

describe('tbank/service — handleWebhook маппинг и идемпотентность', () => {
  it('валидный CONFIRMED → payment_status paid, processed:true', async () => {
    const body = signedBody({ Status: 'CONFIRMED' });
    const res = await service().handleWebhook(body);
    expect(res.verified).toBe(true);
    expect(res.duplicate).toBe(false);
    expect(res.processed).toBe(true);
    expect(res.paymentStatus).toBe('paid');
    expect(applyPaymentStatusMock).toHaveBeenCalledWith(
      'order-uuid-1',
      'paid',
      expect.stringContaining('tbank-webhook:CONFIRMED'),
    );
    expect(markPaymentLogProcessedMock).toHaveBeenCalledWith('log-1');
  });

  it('дубликат (insertPaymentLog inserted:false) → duplicate:true, переход НЕ повторяется', async () => {
    insertPaymentLogMock.mockResolvedValue({ inserted: false, id: null });
    const body = signedBody({ Status: 'CONFIRMED' });
    const res = await service().handleWebhook(body);
    expect(res.verified).toBe(true);
    expect(res.duplicate).toBe(true);
    expect(res.processed).toBe(false);
    expect(applyPaymentStatusMock).not.toHaveBeenCalled();
    expect(markPaymentLogProcessedMock).not.toHaveBeenCalled();
  });

  it('повторная доставка того же события безопасна (идемпотентность)', async () => {
    const body = signedBody({ Status: 'CONFIRMED' });
    // Первая доставка — новое событие.
    insertPaymentLogMock.mockResolvedValueOnce({ inserted: true, id: 'log-1' });
    const first = await service().handleWebhook(body);
    expect(first.processed).toBe(true);
    // Вторая доставка — ON CONFLICT DO NOTHING → дубликат.
    insertPaymentLogMock.mockResolvedValueOnce({ inserted: false, id: null });
    const second = await service().handleWebhook(body);
    expect(second.duplicate).toBe(true);
    expect(second.processed).toBe(false);
    // applyPaymentStatus вызван ровно один раз за две доставки.
    expect(applyPaymentStatusMock).toHaveBeenCalledTimes(1);
  });

  it('REJECTED → payment_status failed', async () => {
    const body = signedBody({ Status: 'REJECTED' });
    const res = await service().handleWebhook(body);
    expect(res.paymentStatus).toBe('failed');
    expect(applyPaymentStatusMock).toHaveBeenCalledWith(
      'order-uuid-1',
      'failed',
      expect.any(String),
    );
  });

  it('заказ не найден → verified:true, processed:false, без падения', async () => {
    getOrderByNumberMock.mockResolvedValue(null);
    const body = signedBody({ Status: 'CONFIRMED' });
    const res = await service().handleWebhook(body);
    expect(res.verified).toBe(true);
    expect(res.processed).toBe(false);
    expect(insertPaymentLogMock).not.toHaveBeenCalled();
  });

  it('неизвестный Status (нет маппинга) → лог пишется, переход не применяется', async () => {
    const body = signedBody({ Status: 'SOME_FUTURE_STATUS' });
    const res = await service().handleWebhook(body);
    expect(res.verified).toBe(true);
    expect(res.paymentStatus).toBeNull();
    expect(applyPaymentStatusMock).not.toHaveBeenCalled();
    // Лог всё равно пишется (аудит) и помечается обработанным.
    expect(insertPaymentLogMock).toHaveBeenCalled();
    expect(markPaymentLogProcessedMock).toHaveBeenCalledWith('log-1');
  });
});
