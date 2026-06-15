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
  };
  return {
    state,
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

// sql: tagged-template, возвращающий [] по умолчанию; sql.begin(cb) выполняет cb с tx.
function makeSqlMock() {
  const tx = (..._args: unknown[]) => Promise.resolve([] as unknown[]);
  const sqlFn = (..._args: unknown[]) => Promise.resolve([] as unknown[]);
  (sqlFn as unknown as { begin: unknown }).begin = vi.fn(
    async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
  );
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
  it('недопустимый переход new→shipped → internal (OrderError), история не пишется', async () => {
    H.state.getOrderByIdQueue = [orderDetail({ status: 'new' })];
    const res = await changeOrderStatus({ id: UUID, to: 'shipped' });
    expect(res).toEqual({ ok: false, error: 'internal' });
    expect(releaseReservationMock).not.toHaveBeenCalled();
    expect(commitReservationMock).not.toHaveBeenCalled();
  });

  it('недопустимый переход оплаты pending→refunded → internal', async () => {
    H.state.getOrderByIdQueue = [orderDetail({ paymentStatus: 'pending' })];
    const res = await setPaymentStatus({ id: UUID, to: 'refunded' });
    expect(res).toEqual({ ok: false, error: 'internal' });
  });

  it('недопустимый переход доставки pending→delivered → internal', async () => {
    H.state.getOrderByIdQueue = [orderDetail({ deliveryStatus: 'pending' })];
    const res = await setDeliveryStatus({ id: UUID, to: 'delivered' });
    expect(res).toEqual({ ok: false, error: 'internal' });
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

  it('createOrder вернул out_of_stock → internal (OrderError)', async () => {
    createOrderMock.mockResolvedValueOnce({
      ok: false,
      code: 'out_of_stock',
      message: 'нет остатка',
    } as never);
    const res = await createManualOrder(manualInput);
    expect(res).toEqual({ ok: false, error: 'internal' });
  });
});
