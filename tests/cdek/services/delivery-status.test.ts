import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Тесты applyDeliveryStatus (docs/08 §8.4) — смена delivery_status через
 * статус-машину canTransition без Server Actions. sql замокан: проверяем, что
 * недопустимый переход не вызывает UPDATE/INSERT, а допустимый — вызывает оба в
 * транзакции.
 */

// Состояние shared между фабрикой мока (hoisted) и тестами.
const h = vi.hoisted(() => {
  const state = { currentStatus: 'in_transit', beginCalls: 0 };
  const txFn = vi.fn(async () => []);
  const sqlFn = vi.fn(async () => [{ delivery_status: state.currentStatus }]) as unknown as {
    (...a: unknown[]): Promise<unknown>;
    begin: ReturnType<typeof vi.fn>;
  };
  sqlFn.begin = vi.fn(async (cb: (tx: unknown) => unknown) => {
    state.beginCalls++;
    return cb(txFn);
  });
  return { state, txFn, sqlFn };
});

vi.mock('@/lib/db/client', () => ({ sql: h.sqlFn }));

import { applyDeliveryStatus } from '@/lib/cdek/services/delivery-status';

const { state } = h;

describe('cdek/delivery-status — applyDeliveryStatus (статус-машина)', () => {
  beforeEach(() => {
    state.beginCalls = 0;
    h.txFn.mockClear();
    h.sqlFn.begin.mockClear();
    (h.sqlFn as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => [
      { delivery_status: state.currentStatus },
    ]);
  });

  it('допустимый переход in_transit → delivered применяется (begin вызван)', async () => {
    state.currentStatus = 'in_transit';
    const ok = await applyDeliveryStatus('ord-1', 'delivered');
    expect(ok).toBe(true);
    expect(state.beginCalls).toBe(1);
  });

  it('недопустимый переход pending → delivered НЕ применяется (begin не вызван)', async () => {
    state.currentStatus = 'pending';
    const ok = await applyDeliveryStatus('ord-1', 'delivered');
    expect(ok).toBe(false);
    expect(state.beginCalls).toBe(0);
  });

  it('переход в тот же статус → no-op', async () => {
    state.currentStatus = 'in_transit';
    const ok = await applyDeliveryStatus('ord-1', 'in_transit');
    expect(ok).toBe(false);
    expect(state.beginCalls).toBe(0);
  });

  it('заказ не найден (нет строки) → false', async () => {
    (h.sqlFn as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => []);
    const ok = await applyDeliveryStatus('ord-x', 'delivered');
    expect(ok).toBe(false);
  });
});
