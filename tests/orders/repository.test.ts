import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Интеграционные тесты слоя данных orders (docs/07 §3.4, §4.2, §6, ADR-010):
 * quoteCart, createOrder (резерв/номер/идемпотентность), гонка резерва.
 *
 * Нужна живая БД с применёнными миграциями 0001..0016 + каталог. В этой среде
 * PostgreSQL нет → describe пропускается (skipIf без DATABASE_URL). Тесты сами
 * создают товар/вариант/остаток и убирают за собой.
 */

const INTEGRATION_DB_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!INTEGRATION_DB_URL)('orders/repository (интеграция, нужна БД)', () => {
  let repo: typeof import('@/lib/orders/repository');
  let sql: typeof import('@/lib/db/client').sql;
  let closeSql: typeof import('@/lib/db/client').closeSql;

  // Идентификаторы созданных фикстур (для cleanup).
  const created = {
    productIds: [] as string[],
    promoIds: [] as string[],
    orderIds: [] as string[],
  };

  /** Создаёт активный товар с inventory(main) и возвращает productId. */
  async function makeProduct(opts: {
    basePrice: string;
    quantity: number;
    reserved?: number;
  }): Promise<string> {
    const suffix = Math.random().toString(36).slice(2, 10);
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (sku, slug, name, status, base_price)
      VALUES (${'OT-' + suffix}, ${'ot-' + suffix}, ${'OrderTest ' + suffix}, 'active', ${opts.basePrice})
      RETURNING id
    `;
    const productId = p!.id;
    created.productIds.push(productId);
    await sql`
      INSERT INTO inventory (product_id, variant_id, warehouse_code, quantity, reserved)
      VALUES (${productId}, NULL, 'main', ${opts.quantity}, ${opts.reserved ?? 0})
    `;
    return productId;
  }

  async function makePromo(over: {
    code: string;
    kind: string;
    value?: string;
    minOrderTotal?: string;
    usageLimit?: number | null;
    perCustomerLimit?: number | null;
  }): Promise<string> {
    const [r] = await sql<{ id: string }[]>`
      INSERT INTO promo_codes (code, kind, value, min_order_total, usage_limit, per_customer_limit, is_active)
      VALUES (${over.code}, ${over.kind}, ${over.value ?? '0'}, ${over.minOrderTotal ?? '0'},
              ${over.usageLimit ?? null}, ${over.perCustomerLimit ?? null}, true)
      RETURNING id
    `;
    created.promoIds.push(r!.id);
    return r!.id;
  }

  function customer(email = 'buyer@example.com') {
    return { name: 'Покупатель', email, phone: '+70000000000' };
  }

  beforeAll(async () => {
    repo = await import('@/lib/orders/repository');
    const db = await import('@/lib/db/client');
    sql = db.sql;
    closeSql = db.closeSql;
  });

  afterAll(async () => {
    // Cleanup в обратном порядке зависимостей.
    for (const id of created.orderIds) {
      await sql`DELETE FROM orders WHERE id = ${id}`;
    }
    await sql`DELETE FROM orders WHERE customer_email IN ('buyer@example.com','race@example.com','limit@example.com')`;
    for (const id of created.promoIds) {
      await sql`DELETE FROM promo_codes WHERE id = ${id}`;
    }
    for (const id of created.productIds) {
      await sql`DELETE FROM inventory WHERE product_id = ${id}`;
      await sql`DELETE FROM products WHERE id = ${id}`;
    }
    if (closeSql) await closeSql();
  });

  it('quoteCart считает итог из каталога (anti-tamper, цены не из запроса)', async () => {
    const productId = await makeProduct({ basePrice: '500.00', quantity: 10 });
    const res = await repo.quoteCart({ items: [{ productId, qty: 2 }] });
    expect(res.quote.itemsTotal).toBe('1000.00');
    expect(res.quote.grandTotal).toBe('1000.00');
    expect(res.fulfillable).toBe(true);
    expect(res.issues).toHaveLength(0);
  });

  it('quoteCart помечает нехватку остатка без создания заказа', async () => {
    const productId = await makeProduct({ basePrice: '100.00', quantity: 1 });
    const res = await repo.quoteCart({ items: [{ productId, qty: 5 }] });
    expect(res.fulfillable).toBe(false);
    expect(res.issues.some((i) => i.code === 'out_of_stock')).toBe(true);
  });

  it('quoteCart применяет percent-промокод', async () => {
    const productId = await makeProduct({ basePrice: '1000.00', quantity: 10 });
    await makePromo({ code: 'PCT10', kind: 'percent', value: '10' });
    const res = await repo.quoteCart({
      items: [{ productId, qty: 1 }],
      promoCode: 'PCT10',
    });
    expect(res.promo?.valid).toBe(true);
    expect(res.quote.discount).toBe('100.00');
    expect(res.quote.grandTotal).toBe('900.00');
  });

  it('createOrder: резерв, номер, снимок позиций, история', async () => {
    const productId = await makeProduct({ basePrice: '250.00', quantity: 5 });
    const r = await repo.createOrder({
      items: [{ productId, qty: 2 }],
      customer: customer(),
      delivery: { type: 'courier' },
      paymentMethod: 'cod',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    created.orderIds.push(r.order.id);

    expect(r.order.number).toMatch(/\d{4}-\d{6}$/);
    expect(r.order.itemsTotal).toBe('500.00');
    expect(r.order.status).toBe('new');

    // Резерв увеличился на 2.
    const [inv] = await sql<{ reserved: number }[]>`
      SELECT reserved FROM inventory WHERE product_id = ${productId} AND warehouse_code = 'main'
    `;
    expect(Number(inv!.reserved)).toBe(2);

    // Позиции (снимок).
    const detail = await repo.getOrderById(r.order.id);
    expect(detail?.items).toHaveLength(1);
    expect(detail?.items[0]?.unitPrice).toBe('250.00');
    expect(detail?.items[0]?.lineTotal).toBe('500.00');

    // История.
    const hist = await sql<{ to_status: string }[]>`
      SELECT to_status FROM order_status_history WHERE order_id = ${r.order.id}
    `;
    expect(hist.map((h) => h.to_status)).toContain('new');
  });

  it('createOrder идемпотентен по idempotency_key (не дублирует)', async () => {
    const productId = await makeProduct({ basePrice: '100.00', quantity: 10 });
    const key = 'idem-' + Math.random().toString(36).slice(2);
    const args = {
      items: [{ productId, qty: 1 }],
      customer: customer(),
      delivery: { type: 'courier' as const },
      paymentMethod: 'cod' as const,
      idempotencyKey: key,
    };
    const a = await repo.createOrder(args);
    const b = await repo.createOrder(args);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok) created.orderIds.push(a.order.id);
    if (a.ok && b.ok) {
      expect(b.reused).toBe(true);
      expect(b.order.id).toBe(a.order.id);
    }
    // Резерв списан ровно один раз (1), не два.
    const [inv] = await sql<{ reserved: number }[]>`
      SELECT reserved FROM inventory WHERE product_id = ${productId} AND warehouse_code = 'main'
    `;
    expect(Number(inv!.reserved)).toBe(1);
  });

  it('createOrder отклоняет при нехватке остатка', async () => {
    const productId = await makeProduct({ basePrice: '100.00', quantity: 1 });
    const r = await repo.createOrder({
      items: [{ productId, qty: 3 }],
      customer: customer(),
      delivery: { type: 'courier' },
      paymentMethod: 'cod',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('out_of_stock');
  });

  it('гонка резерва: только один из двух параллельных заказов на последний остаток', async () => {
    const productId = await makeProduct({ basePrice: '100.00', quantity: 1 });
    const mk = () =>
      repo.createOrder({
        items: [{ productId, qty: 1 }],
        customer: customer('race@example.com'),
        delivery: { type: 'courier' },
        paymentMethod: 'cod',
      });
    const [a, b] = await Promise.all([mk(), mk()]);
    const oks = [a, b].filter((x) => x.ok);
    expect(oks).toHaveLength(1);
    for (const x of [a, b]) if (x.ok) created.orderIds.push(x.order.id);

    const [inv] = await sql<{ reserved: number; quantity: number }[]>`
      SELECT reserved, quantity FROM inventory WHERE product_id = ${productId} AND warehouse_code = 'main'
    `;
    expect(Number(inv!.reserved)).toBe(1);
  });

  it('лимит промокода: usage_limit исчерпывается, второй заказ отклоняется', async () => {
    const productId = await makeProduct({ basePrice: '1000.00', quantity: 10 });
    await makePromo({ code: 'ONCE', kind: 'fixed', value: '100.00', usageLimit: 1 });
    const mk = () =>
      repo.createOrder({
        items: [{ productId, qty: 1 }],
        customer: customer('limit@example.com'),
        delivery: { type: 'courier' },
        paymentMethod: 'cod',
        promoCode: 'ONCE',
      });
    const a = await mk();
    expect(a.ok).toBe(true);
    if (a.ok) created.orderIds.push(a.order.id);
    const b = await mk();
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe('invalid_promo');
  });

  it('commitReservation/releaseReservation двигают остаток корректно', async () => {
    const productId = await makeProduct({ basePrice: '100.00', quantity: 10, reserved: 0 });
    // Резерв 3.
    await sql.begin(async (tx) => {
      const ok = await repo.reserveUnit(tx, { productId, variantId: null, qty: 3 });
      expect(ok).toBe(true);
    });
    // Списание (отгрузка) 2: quantity 10→8, reserved 3→1.
    await sql.begin(async (tx) => {
      await repo.commitReservation(tx, { productId, variantId: null, qty: 2 });
    });
    // Возврат резерва 1: reserved 1→0.
    await sql.begin(async (tx) => {
      await repo.releaseReservation(tx, { productId, variantId: null, qty: 1 });
    });
    const [inv] = await sql<{ reserved: number; quantity: number }[]>`
      SELECT reserved, quantity FROM inventory WHERE product_id = ${productId} AND warehouse_code = 'main'
    `;
    expect(Number(inv!.quantity)).toBe(8);
    expect(Number(inv!.reserved)).toBe(0);
  });
});
