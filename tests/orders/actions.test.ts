import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/lib/auth/rbac';
import type { PermissionCode } from '@/lib/auth/permissions';

/**
 * ЮНИТ-тесты Server Actions админки orders (пакет 3.C) — БЕЗ БД/Next.
 *
 * Реальные actions (lib/orders/actions.ts) импортируют repository и sql напрямую,
 * поэтому изолируем их vi.mock-ами:
 *   • @/lib/auth/session.getCurrentUser → подменяемый текущий пользователь (guard);
 *   • @/lib/db/client.sql              → мок c .begin (транзакция) + tagged-template;
 *   • @/lib/orders/repository          → мок getOrderById / release / commit / createOrder;
 *   • @/lib/audit/log.writeAudit       → шпион (проверяем формирование записи);
 *   • next/cache.revalidatePath        → no-op.
 *
 * Проверяем: guard (нет orders.write → forbidden, unauthorized, owner проходит),
 * валидацию (невалидный переход статуса отклонён, Zod-ошибки промокода),
 * вызов release при отмене, формирование audit-записи. БД не дёргается.
 */

// --- управляемое состояние моков ---------------------------------------------

// Состояние мок-окружения. Объявлено через vi.hoisted, т.к. vi.mock-фабрики
// поднимаются на верх файла и иначе обращались бы к ещё не инициализированным
// переменным (ReferenceError при изолированном запуске файла).
const H = vi.hoisted(() => {
  const state = {
    currentUser: null as AuthUser | null,
    getOrderByIdQueue: [] as unknown[],
    /**
     * Очередь результатов для запросов ВНУТРИ транзакции (tx`...`). Каждый вызов
     * tagged-template tx снимает один элемент. По умолчанию (пусто) → []. Нужна
     * для проверки guarded-UPDATE (Fix 1: UPDATE ... WHERE status=from RETURNING id
     * → affected rows контролируем сюда) и отката промокода (Fix 4).
     */
    txResultQueue: [] as unknown[][],
    /** Лог SQL-запросов внутри транзакции (строки шаблонов) — для проверок Fix 1/4. */
    txCalls: [] as string[][],
  };
  // sql.begin как управляемый спай: по умолчанию выполняет колбэк с tx-моком.
  // tx`...` снимает результат из txResultQueue, а если очередь пуста — возвращает
  // ОДНУ строку [{ id }] по умолчанию. Это нужно, чтобы guarded UPDATE (Fix 1:
  // `... RETURNING id`) по умолчанию считался успешным (affected rows = 1) и
  // happy-path тесты переходов проходили. Для проверки КОНФЛИКТА тест кладёт в
  // txResultQueue пустой массив [] (0 строк) как результат первого UPDATE.
  const DEFAULT_TX_ROW = [{ id: 'tx-row-id' }];
  const sqlBeginMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = (strings: TemplateStringsArray, ..._args: unknown[]) => {
      // Записываем шаблон (склейку статических кусков) — позволяет утверждать
      // наличие «AND status =» / «promo_redemptions» / «used_count» в запросе.
      state.txCalls.push(Array.from(strings ?? []));
      const next = state.txResultQueue.length > 0 ? state.txResultQueue.shift()! : DEFAULT_TX_ROW;
      return Promise.resolve(next);
    };
    (tx as unknown as { json: unknown }).json = (v: unknown) => v;
    return cb(tx);
  });
  return {
    state,
    sqlBeginMock,
    writeAuditSpy: vi.fn(async (..._args: unknown[]) => {}),
    getCurrentUserMock: vi.fn(async () => state.currentUser),
    getOrderByIdMock: vi.fn(async (..._args: unknown[]) => state.getOrderByIdQueue.shift() ?? null),
    releaseReservationMock: vi.fn(async (..._args: unknown[]) => true),
    commitReservationMock: vi.fn(async (..._args: unknown[]) => true),
    createOrderMock: vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      reused: false,
      order: { id: 'o-new', number: 'GA-2026-000001', grandTotal: '100.00', source: 'admin' },
    })),
  };
});

const {
  sqlBeginMock,
  writeAuditSpy,
  getCurrentUserMock,
  getOrderByIdMock,
  releaseReservationMock,
  commitReservationMock,
  createOrderMock,
} = H;

// --- vi.mock (hoisted) -------------------------------------------------------

vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: H.getCurrentUserMock,
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  writeAudit: (...args: unknown[]) => H.writeAuditSpy(...(args as [])),
}));

vi.mock('@/lib/config/modules', () => ({
  isModuleEnabled: () => true,
}));

// next/headers недоступен в node-окружении vitest — мокаем getRequestMeta косвенно
// через мок next/headers (defineAction импортирует его динамически).
vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

// sql: tagged-template, возвращающий [] по умолчанию; sql.begin — управляемый
// спай H.sqlBeginMock (выполняет колбэк с tx-моком, снимающим txResultQueue).
function makeSqlMock() {
  const sqlFn = (..._args: unknown[]) => Promise.resolve([] as unknown[]);
  (sqlFn as unknown as { begin: unknown }).begin = H.sqlBeginMock;
  (sqlFn as unknown as { json: unknown }).json = (v: unknown) => v;
  return sqlFn;
}

vi.mock('@/lib/db/client', () => ({
  sql: makeSqlMock(),
}));

vi.mock('@/lib/orders/repository', () => ({
  getOrderById: H.getOrderByIdMock,
  releaseReservation: H.releaseReservationMock,
  commitReservation: H.commitReservationMock,
  createOrder: H.createOrderMock,
  // мапперы реэкспортируются модулем — actions их типизирует, но в рантайме не зовёт
  mapOrder: (r: unknown) => r,
  mapOrderItem: (r: unknown) => r,
}));

// Импорт actions ПОСЛЕ моков.
import {
  changeOrderStatus,
  cancelOrder,
  refundOrder,
  setPaymentStatus,
  setDeliveryStatus,
  createManualOrder,
  getOrder,
  createPromoCode,
  updatePromoCode,
  deletePromoCode,
  deactivatePromoCode,
} from '@/lib/orders/actions';

// --- хелперы -----------------------------------------------------------------

function makeUser(perms: PermissionCode[], isOwner = false): AuthUser {
  return {
    id: 'u-1',
    email: 'u@shop.io',
    isOwner,
    permissions: new Set<PermissionCode>(perms),
  };
}

const UUID = '11111111-1111-4111-8111-111111111111';

function orderDetail(over: Record<string, unknown> = {}) {
  return {
    order: {
      id: UUID,
      number: 'GA-2026-000001',
      status: 'new',
      paymentStatus: 'pending',
      deliveryStatus: 'pending',
      ...over,
    },
    items: [
      { productId: 'p-1', variantId: null, quantity: 2, skuSnapshot: 'SKU-1' },
    ],
  };
}

beforeEach(() => {
  H.state.currentUser = makeUser(['orders.read', 'orders.write']);
  H.state.getOrderByIdQueue = [];
  H.state.txResultQueue = [];
  H.state.txCalls = [];
  sqlBeginMock.mockClear();
  writeAuditSpy.mockClear();
  getOrderByIdMock.mockClear();
  releaseReservationMock.mockClear();
  commitReservationMock.mockClear();
  createOrderMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// GUARD (orders.read / orders.write).
// =============================================================================

describe('guard прав', () => {
  it('не аутентифицирован → unauthorized', async () => {
    H.state.currentUser = null;
    const res = await changeOrderStatus({ id: UUID, to: 'paid' });
    expect(res).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('нет orders.write → forbidden (только orders.read)', async () => {
    H.state.currentUser = makeUser(['orders.read']);
    const res = await changeOrderStatus({ id: UUID, to: 'paid' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('orders.write проходит guard (валидный переход new→paid)', async () => {
    H.state.currentUser = makeUser(['orders.write']);
    H.state.getOrderByIdQueue = [orderDetail({ status: 'new' }), orderDetail({ status: 'paid' })];
    const res = await changeOrderStatus({ id: UUID, to: 'paid' });
    expect(res.ok).toBe(true);
  });

  it('owner проходит без явного права', async () => {
    H.state.currentUser = makeUser([], true);
    H.state.getOrderByIdQueue = [orderDetail({ status: 'new' }), orderDetail({ status: 'paid' })];
    const res = await changeOrderStatus({ id: UUID, to: 'paid' });
    expect(res.ok).toBe(true);
  });

  it('getOrder требует orders.read → forbidden без права', async () => {
    H.state.currentUser = makeUser([]);
    const res = await getOrder({ id: UUID });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('createPromoCode требует orders.write → forbidden с orders.read', async () => {
    H.state.currentUser = makeUser(['orders.read']);
    const res = await createPromoCode({ code: 'SALE', kind: 'fixed', value: '100' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});

// =============================================================================
// ВАЛИДАЦИЯ ПЕРЕХОДА СТАТУСА (status.ts canTransition).
// =============================================================================

describe('валидация перехода статуса', () => {
  it('недопустимый переход new→shipped → validation + message (OrderError), история не пишется', async () => {
    // OrderError extends PublicActionError → пайплайн отдаёт error:'validation' + текст.
    H.state.getOrderByIdQueue = [orderDetail({ status: 'new' })];
    const res = await changeOrderStatus({ id: UUID, to: 'shipped' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
    expect(res.message).toContain('Недопустимый переход');
    expect(releaseReservationMock).not.toHaveBeenCalled();
    expect(commitReservationMock).not.toHaveBeenCalled();
  });

  it('недопустимый переход оплаты pending→refunded → validation + message', async () => {
    H.state.getOrderByIdQueue = [orderDetail({ paymentStatus: 'pending' })];
    const res = await setPaymentStatus({ id: UUID, to: 'refunded' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
    expect(res.message).toContain('Недопустимый переход статуса оплаты');
  });

  it('недопустимый переход доставки pending→delivered → validation + message', async () => {
    H.state.getOrderByIdQueue = [orderDetail({ deliveryStatus: 'pending' })];
    const res = await setDeliveryStatus({ id: UUID, to: 'delivered' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
    expect(res.message).toContain('Недопустимый переход статуса доставки');
  });

  it('допустимый переход доставки pending→registered → ok', async () => {
    H.state.getOrderByIdQueue = [
      orderDetail({ deliveryStatus: 'pending' }),
      orderDetail({ deliveryStatus: 'registered' }),
    ];
    const res = await setDeliveryStatus({ id: UUID, to: 'registered' });
    expect(res.ok).toBe(true);
  });
});

// =============================================================================
// ДОМЕННЫЕ ОШИБКИ ДОНОСЯТ message ДО UI (OrderError extends PublicActionError).
// =============================================================================

describe('доменные ошибки → validation + message (не «internal»)', () => {
  it('getOrder: заказ не найден → validation + «Заказ не найден.»', async () => {
    // Пустая очередь getOrderById → null → OrderError('not_found').
    H.state.getOrderByIdQueue = [];
    const res = await getOrder({ id: UUID });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
    expect(res.message).toBe('Заказ не найден.');
  });

  it('changeOrderStatus: заказ не найден → validation + «Заказ не найден.»', async () => {
    H.state.getOrderByIdQueue = [];
    const res = await changeOrderStatus({ id: UUID, to: 'paid' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
    expect(res.message).toBe('Заказ не найден.');
  });

  it('createPromoCode: дубликат кода (PG 23505) → validation + «уже существует»', async () => {
    // sql.begin бросает ошибку с code='23505' → isUniqueViolation → OrderError('duplicate_code').
    const dupErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    sqlBeginMock.mockImplementationOnce(async () => {
      throw dupErr;
    });
    const res = await createPromoCode({ code: 'SALE', kind: 'fixed', value: '100' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
    expect(res.message).toContain('уже существует');
  });

  it('deletePromoCode: промокод не найден → validation + «Промокод не найден.»', async () => {
    // sql`DELETE ... RETURNING id` → [] (мок по умолчанию) → OrderError('not_found').
    const res = await deletePromoCode({ id: UUID });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
    expect(res.message).toBe('Промокод не найден.');
  });
});

// =============================================================================
// РЕЗЕРВ ОСТАТКОВ ПРИ ПЕРЕХОДАХ (§6).
// =============================================================================

describe('резерв остатков при переходах', () => {
  it('отмена (paid→cancelled) вызывает releaseReservation по позиции', async () => {
    H.state.getOrderByIdQueue = [
      orderDetail({ status: 'paid' }),
      orderDetail({ status: 'cancelled' }),
    ];
    const res = await cancelOrder({ id: UUID, reason: 'передумал' });
    expect(res.ok).toBe(true);
    expect(releaseReservationMock).toHaveBeenCalledTimes(1);
    expect(releaseReservationMock).toHaveBeenCalledWith(expect.anything(), {
      productId: 'p-1',
      variantId: null,
      qty: 2,
    });
    expect(commitReservationMock).not.toHaveBeenCalled();
  });

  it('отгрузка (packed→shipped) вызывает commitReservation (списание)', async () => {
    H.state.getOrderByIdQueue = [
      orderDetail({ status: 'packed' }),
      orderDetail({ status: 'shipped' }),
    ];
    const res = await changeOrderStatus({ id: UUID, to: 'shipped' });
    expect(res.ok).toBe(true);
    expect(commitReservationMock).toHaveBeenCalledTimes(1);
    expect(releaseReservationMock).not.toHaveBeenCalled();
  });

  it('возврат (delivered→refunded) вызывает release и синхронизирует оплату', async () => {
    H.state.getOrderByIdQueue = [
      orderDetail({ status: 'delivered', paymentStatus: 'paid' }),
      orderDetail({ status: 'refunded', paymentStatus: 'refunded' }),
    ];
    const res = await refundOrder({ id: UUID });
    expect(res.ok).toBe(true);
    expect(releaseReservationMock).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// GUARDED UPDATE / TOCTOU-ГОНКА СТАТУСА (Fix 1, §2.8).
//
// Юнит-уровень: проверяем, что (а) UPDATE статуса несёт guard `AND status = from`,
// (б) при affected rows ≠ 1 (конкурентный переход) action отдаёт конфликт и НЕ
// пишет историю/побочные эффекты. Полная конкурентность (2 параллельных перехода
// на живой БД) валидируется интеграционным тестом в repository.test.ts (нужна БД).
// =============================================================================

describe('guarded UPDATE статуса (TOCTOU)', () => {
  /** Был ли среди tx-запросов guarded UPDATE по нужной колонке (`AND <col> =`). */
  function hasGuard(col: string): boolean {
    return H.state.txCalls.some((tpl) => tpl.join('|').includes(`AND ${col} =`));
  }
  /** Был ли INSERT в order_status_history среди tx-запросов. */
  function wroteHistory(): boolean {
    return H.state.txCalls.some((tpl) => tpl.join('|').includes('order_status_history'));
  }

  it('order: UPDATE несёт guard «AND status =» (happy-path new→paid)', async () => {
    H.state.getOrderByIdQueue = [orderDetail({ status: 'new' }), orderDetail({ status: 'paid' })];
    const res = await changeOrderStatus({ id: UUID, to: 'paid' });
    expect(res.ok).toBe(true);
    expect(hasGuard('status')).toBe(true);
    expect(wroteHistory()).toBe(true);
  });

  it('order: конкурентный переход (guarded UPDATE 0 строк) → conflict, история НЕ пишется', async () => {
    // Первый tx-запрос (guarded UPDATE) вернёт [] → affected rows = 0 → конфликт.
    H.state.getOrderByIdQueue = [orderDetail({ status: 'new' })];
    H.state.txResultQueue = [[]];
    const res = await changeOrderStatus({ id: UUID, to: 'paid' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation'); // OrderError('conflict') → PublicActionError
    expect(res.message).toContain('изменился параллельно');
    expect(wroteHistory()).toBe(false);
    expect(releaseReservationMock).not.toHaveBeenCalled();
    expect(commitReservationMock).not.toHaveBeenCalled();
    expect(writeAuditSpy).not.toHaveBeenCalled();
  });

  it('payment: UPDATE несёт guard «AND payment_status =» (happy-path pending→paid)', async () => {
    H.state.getOrderByIdQueue = [
      orderDetail({ paymentStatus: 'pending' }),
      orderDetail({ paymentStatus: 'paid' }),
    ];
    const res = await setPaymentStatus({ id: UUID, to: 'paid' });
    expect(res.ok).toBe(true);
    expect(hasGuard('payment_status')).toBe(true);
    expect(wroteHistory()).toBe(true);
  });

  it('payment: конкурентный переход (0 строк) → conflict, история НЕ пишется', async () => {
    H.state.getOrderByIdQueue = [orderDetail({ paymentStatus: 'pending' })];
    H.state.txResultQueue = [[]];
    const res = await setPaymentStatus({ id: UUID, to: 'paid' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
    expect(res.message).toContain('изменился параллельно');
    expect(wroteHistory()).toBe(false);
  });

  it('delivery: UPDATE несёт guard «AND delivery_status =» (happy-path pending→registered)', async () => {
    H.state.getOrderByIdQueue = [
      orderDetail({ deliveryStatus: 'pending' }),
      orderDetail({ deliveryStatus: 'registered' }),
    ];
    const res = await setDeliveryStatus({ id: UUID, to: 'registered' });
    expect(res.ok).toBe(true);
    expect(hasGuard('delivery_status')).toBe(true);
    expect(wroteHistory()).toBe(true);
  });

  it('delivery: конкурентный переход (0 строк) → conflict, история НЕ пишется', async () => {
    H.state.getOrderByIdQueue = [orderDetail({ deliveryStatus: 'pending' })];
    H.state.txResultQueue = [[]];
    const res = await setDeliveryStatus({ id: UUID, to: 'registered' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
    expect(res.message).toContain('изменился параллельно');
    expect(wroteHistory()).toBe(false);
  });
});

// =============================================================================
// ОТКАТ ПРОМОКОДА ПРИ ОТМЕНЕ/ВОЗВРАТЕ (Fix 4, §5.2).
// =============================================================================

describe('откат used_count/promo_redemptions при cancel/refund', () => {
  const PROMO_ID = '22222222-2222-4222-8222-222222222222';

  /** Все статические куски tx-запросов одной плоской строкой (для поиска DELETE/UPDATE). */
  function txText(): string {
    return H.state.txCalls.map((tpl) => tpl.join('|')).join('||');
  }

  it('cancel с promoCodeId: DELETE promo_redemptions + UPDATE used_count (редемпшн удалён)', async () => {
    H.state.getOrderByIdQueue = [
      orderDetail({ status: 'paid', promoCodeId: PROMO_ID }),
      orderDetail({ status: 'cancelled', promoCodeId: PROMO_ID }),
    ];
    // Порядок tx-запросов: guarded UPDATE orders → DELETE promo_redemptions → UPDATE promo_codes → INSERT history.
    // Дефолт DEFAULT_TX_ROW (1 строка) подойдёт для всех (guarded UPDATE ok; DELETE «удалил» 1).
    const res = await cancelOrder({ id: UUID });
    expect(res.ok).toBe(true);
    const text = txText();
    expect(text).toContain('DELETE FROM promo_redemptions');
    expect(text).toContain('used_count = GREATEST');
  });

  it('refund с promoCodeId: тоже откатывает (DELETE + GREATEST used_count − N)', async () => {
    H.state.getOrderByIdQueue = [
      orderDetail({ status: 'delivered', paymentStatus: 'paid', promoCodeId: PROMO_ID }),
      orderDetail({ status: 'refunded', paymentStatus: 'refunded', promoCodeId: PROMO_ID }),
    ];
    const res = await refundOrder({ id: UUID });
    expect(res.ok).toBe(true);
    const text = txText();
    expect(text).toContain('DELETE FROM promo_redemptions');
    expect(text).toContain('used_count = GREATEST');
  });

  it('cancel без promoCodeId: откат НЕ выполняется (нет DELETE/used_count)', async () => {
    H.state.getOrderByIdQueue = [
      orderDetail({ status: 'paid', promoCodeId: null }),
      orderDetail({ status: 'cancelled', promoCodeId: null }),
    ];
    const res = await cancelOrder({ id: UUID });
    expect(res.ok).toBe(true);
    const text = txText();
    expect(text).not.toContain('promo_redemptions');
    expect(text).not.toContain('used_count');
  });

  it('cancel: повторный откат идемпотентен — DELETE вернул 0 строк → used_count НЕ трогаем', async () => {
    H.state.getOrderByIdQueue = [
      orderDetail({ status: 'paid', promoCodeId: PROMO_ID }),
      orderDetail({ status: 'cancelled', promoCodeId: PROMO_ID }),
    ];
    // tx-результаты по порядку: [1] guarded UPDATE orders → ok (1 строка),
    // [2] DELETE promo_redemptions → [] (редемпшн уже откачен ранее).
    // Тогда UPDATE used_count выполняться НЕ должен.
    H.state.txResultQueue = [[{ id: 'tx-row-id' }], []];
    const res = await cancelOrder({ id: UUID });
    expect(res.ok).toBe(true);
    const text = txText();
    expect(text).toContain('DELETE FROM promo_redemptions');
    expect(text).not.toContain('used_count');
  });

  it('shipped (commit) с promoCodeId: откат НЕ выполняется (только cancel/refund откатывают)', async () => {
    H.state.getOrderByIdQueue = [
      orderDetail({ status: 'packed', promoCodeId: PROMO_ID }),
      orderDetail({ status: 'shipped', promoCodeId: PROMO_ID }),
    ];
    const res = await changeOrderStatus({ id: UUID, to: 'shipped' });
    expect(res.ok).toBe(true);
    const text = txText();
    expect(text).not.toContain('promo_redemptions');
    expect(text).not.toContain('used_count');
  });
});

// =============================================================================
// AUDIT (формирование записи).
// =============================================================================

describe('аудит-запись', () => {
  it('changeOrderStatus пишет audit order.status.change с before/after', async () => {
    H.state.getOrderByIdQueue = [orderDetail({ status: 'new' }), orderDetail({ status: 'paid' })];
    await changeOrderStatus({ id: UUID, to: 'paid' });
    expect(writeAuditSpy).toHaveBeenCalledTimes(1);
    const [entry] = writeAuditSpy.mock.calls[0] as [Record<string, unknown>];
    expect(entry).toMatchObject({
      action: 'order.status.change',
      entityType: 'order',
      entityId: UUID,
      before: { status: 'new' },
      after: { status: 'paid' },
    });
  });

  it('cancelOrder пишет audit order.cancel', async () => {
    H.state.getOrderByIdQueue = [
      orderDetail({ status: 'new' }),
      orderDetail({ status: 'cancelled' }),
    ];
    await cancelOrder({ id: UUID });
    const [entry] = writeAuditSpy.mock.calls[0] as [Record<string, unknown>];
    expect(entry).toMatchObject({ action: 'order.cancel', entityId: UUID });
  });

  it('недопустимый переход → audit НЕ пишется', async () => {
    H.state.getOrderByIdQueue = [orderDetail({ status: 'new' })];
    await changeOrderStatus({ id: UUID, to: 'shipped' });
    expect(writeAuditSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// ПРОМОКОДЫ — Zod-валидация + аудит promo.*.
// =============================================================================

describe('промокоды: валидация и аудит', () => {
  it('createPromoCode: percent value > 100 → validation', async () => {
    const res = await createPromoCode({ code: 'BIG', kind: 'percent', value: '150' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
  });

  it('createPromoCode: пустой код → validation', async () => {
    const res = await createPromoCode({ code: '', kind: 'fixed', value: '100' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
  });

  it('updatePromoCode: bogo pay_qty >= buy_qty → validation', async () => {
    const res = await updatePromoCode({
      id: UUID,
      kind: 'bogo',
      bogoBuyQty: 2,
      bogoPayQty: 3,
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
  });

  it('deletePromoCode требует orders.write → forbidden без права', async () => {
    H.state.currentUser = makeUser(['orders.read']);
    const res = await deletePromoCode({ id: UUID });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('deactivatePromoCode: невалидный id → validation', async () => {
    const res = await deactivatePromoCode({ id: 'not-a-uuid' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
  });
});

// =============================================================================
// РУЧНОЕ СОЗДАНИЕ ЗАКАЗА (createManualOrder → repository.createOrder с source='admin').
// =============================================================================

describe('createManualOrder', () => {
  const manualInput = {
    items: [{ productId: UUID, qty: 1 }],
    customer: { name: 'Иван', email: 'i@shop.io', phone: '+70000000000' },
    delivery: { type: 'pickup' as const },
    paymentMethod: 'cod' as const,
  };

  it('требует orders.write → forbidden с orders.read', async () => {
    H.state.currentUser = makeUser(['orders.read']);
    const res = await createManualOrder(manualInput);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('вызывает createOrder с source=admin и пишет audit order.create.manual', async () => {
    const res = await createManualOrder(manualInput);
    expect(res.ok).toBe(true);
    expect(createOrderMock).toHaveBeenCalledTimes(1);
    const [, ctxArg] = createOrderMock.mock.calls[0] as [unknown, { source?: string }];
    expect(ctxArg.source).toBe('admin');
    const [entry] = writeAuditSpy.mock.calls[0] as [Record<string, unknown>];
    expect(entry).toMatchObject({ action: 'order.create.manual', entityType: 'order' });
  });

  it('createOrder вернул out_of_stock → validation + message (OrderError доносит текст)', async () => {
    createOrderMock.mockResolvedValueOnce({
      ok: false,
      code: 'out_of_stock',
      message: 'нет остатка',
    } as never);
    const res = await createManualOrder(manualInput);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('ожидался отказ');
    expect(res.error).toBe('validation');
    expect(res.message).toBe('нет остатка');
  });
});
