import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Тесты applyPaymentStatus (docs/15 §4.4) — атомарная смена payment_status через
 * статус-машину canTransition БЕЗ Server Actions. sql замокан.
 *
 * КЛЮЧЕВОЕ (MAJOR data-integrity): чтение `from` + проверка перехода + запись
 * ДОЛЖНЫ быть в ОДНОЙ транзакции с SELECT ... FOR UPDATE и guarded UPDATE
 * (WHERE payment_status = from). Конкурентный/out-of-order webhook не должен
 * откатить уже выставленный статус (paid → authorized) — guarded UPDATE даёт
 * rowCount=0 и переход пропускается даже если canTransition по «прочитанному»
 * значению формально прошёл.
 *
 * Мок транзакции:
 *   tx`SELECT ... FOR UPDATE` → [{ payment_status }]
 *   tx`UPDATE orders ...`     → массив с .count (postgres.js даёт count у результата)
 *   tx`INSERT order_status_history ...` → []
 * Различаем запросы по тексту первого фрагмента tagged-template.
 */

interface TxQueryLog {
  text: string;
}

const h = vi.hoisted(() => {
  const state = {
    // Значение, которое вернёт SELECT ... FOR UPDATE (фактическое в БД на момент tx).
    selectStatus: 'authorized' as string | null,
    // Сколько строк «затронул» guarded UPDATE (0 → конкурентная гонка проиграна).
    updateCount: 1,
    beginCalls: 0,
    queries: [] as TxQueryLog[],
  };

  const txTag = vi.fn((strings: TemplateStringsArray, ..._vals: unknown[]) => {
    const text = strings.join('?').trim();
    state.queries.push({ text });
    if (/^SELECT/i.test(text)) {
      const rows = state.selectStatus === null ? [] : [{ payment_status: state.selectStatus }];
      return Promise.resolve(rows);
    }
    if (/^UPDATE/i.test(text)) {
      const arr: unknown[] = [];
      (arr as unknown as { count: number }).count = state.updateCount;
      return Promise.resolve(arr);
    }
    // INSERT history и прочее.
    return Promise.resolve([]);
  });

  const sqlFn = vi.fn(() => Promise.resolve([])) as unknown as {
    (...a: unknown[]): Promise<unknown>;
    begin: ReturnType<typeof vi.fn>;
  };
  sqlFn.begin = vi.fn(async (cb: (tx: unknown) => unknown) => {
    state.beginCalls++;
    return cb(txTag);
  });

  return { state, txTag, sqlFn };
});

vi.mock('@/lib/db/client', () => ({ sql: h.sqlFn }));

import { applyPaymentStatus } from '@/lib/payments/tbank/repository';

const { state } = h;

function reset(): void {
  state.selectStatus = 'authorized';
  state.updateCount = 1;
  state.beginCalls = 0;
  state.queries = [];
  h.txTag.mockClear();
  h.sqlFn.begin.mockClear();
}

beforeEach(reset);

describe('tbank/repository — applyPaymentStatus (атомарность)', () => {
  it('допустимый переход authorized → paid применяется', async () => {
    state.selectStatus = 'authorized';
    state.updateCount = 1;
    const ok = await applyPaymentStatus('ord-1', 'paid');
    expect(ok).toBe(true);
  });

  it('чтение from идёт ВНУТРИ транзакции с SELECT ... FOR UPDATE', async () => {
    state.selectStatus = 'authorized';
    await applyPaymentStatus('ord-1', 'paid');
    expect(state.beginCalls).toBe(1);
    const select = state.queries.find((q) => /^SELECT/i.test(q.text));
    expect(select).toBeDefined();
    expect(select!.text.toUpperCase()).toContain('FOR UPDATE');
    // SELECT должен быть до UPDATE (внутри той же транзакции).
    const idxSelect = state.queries.findIndex((q) => /^SELECT/i.test(q.text));
    const idxUpdate = state.queries.findIndex((q) => /^UPDATE/i.test(q.text));
    expect(idxSelect).toBeGreaterThanOrEqual(0);
    expect(idxUpdate).toBeGreaterThan(idxSelect);
  });

  it('guarded UPDATE содержит WHERE по payment_status = from (анти-гонка)', async () => {
    state.selectStatus = 'authorized';
    await applyPaymentStatus('ord-1', 'paid');
    const upd = state.queries.find((q) => /^UPDATE/i.test(q.text));
    expect(upd).toBeDefined();
    expect(upd!.text.toLowerCase()).toContain('payment_status =');
    // Условие защиты «AND payment_status = ${from}».
    expect(upd!.text.toLowerCase()).toContain('and payment_status =');
  });

  it('guarded UPDATE затронул 0 строк (конкурентный webhook) → переход НЕ применён, история НЕ пишется', async () => {
    // Сценарий гонки: SELECT прочитал authorized (стейл), но к моменту UPDATE
    // другой webhook уже выставил paid → WHERE payment_status='authorized' даёт 0.
    state.selectStatus = 'authorized';
    state.updateCount = 0;
    const ok = await applyPaymentStatus('ord-1', 'paid');
    expect(ok).toBe(false);
    const insert = state.queries.find((q) => /^INSERT/i.test(q.text));
    expect(insert).toBeUndefined();
  });

  it('out-of-order: уже paid, приходит authorized → недопустим, история НЕ пишется', async () => {
    // canTransition('payment', 'paid', 'authorized') === false.
    state.selectStatus = 'paid';
    const ok = await applyPaymentStatus('ord-1', 'authorized');
    expect(ok).toBe(false);
    const insert = state.queries.find((q) => /^INSERT/i.test(q.text));
    expect(insert).toBeUndefined();
  });

  it('from === to → no-op (false), без UPDATE/INSERT', async () => {
    state.selectStatus = 'paid';
    const ok = await applyPaymentStatus('ord-1', 'paid');
    expect(ok).toBe(false);
    const upd = state.queries.find((q) => /^UPDATE/i.test(q.text));
    const insert = state.queries.find((q) => /^INSERT/i.test(q.text));
    expect(upd).toBeUndefined();
    expect(insert).toBeUndefined();
  });

  it('заказ не найден (SELECT пуст) → false', async () => {
    state.selectStatus = null;
    const ok = await applyPaymentStatus('ord-x', 'paid');
    expect(ok).toBe(false);
  });

  it('paid проставляет paid_at в UPDATE', async () => {
    state.selectStatus = 'authorized';
    await applyPaymentStatus('ord-1', 'paid');
    const upd = state.queries.find((q) => /^UPDATE/i.test(q.text));
    expect(upd!.text.toLowerCase()).toContain('paid_at');
  });

  it('успешный переход пишет историю (INSERT order_status_history)', async () => {
    state.selectStatus = 'authorized';
    state.updateCount = 1;
    await applyPaymentStatus('ord-1', 'paid');
    const insert = state.queries.find((q) => /^INSERT/i.test(q.text));
    expect(insert).toBeDefined();
    expect(insert!.text.toLowerCase()).toContain('order_status_history');
  });
});
