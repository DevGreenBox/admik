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
    categoryIds: [] as string[],
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
    bogoBuyQty?: number | null;
    bogoPayQty?: number | null;
    applyScope?: 'cart' | 'category' | 'brand' | 'set';
    minQty?: number | null;
    giftProductId?: string | null;
    giftVariantId?: string | null;
    giftQty?: number | null;
  }): Promise<string> {
    const [r] = await sql<{ id: string }[]>`
      INSERT INTO promo_codes (
        code, kind, value, min_order_total, usage_limit, per_customer_limit,
        bogo_buy_qty, bogo_pay_qty, apply_scope, min_qty,
        gift_product_id, gift_variant_id, gift_qty, is_active
      )
      VALUES (
        ${over.code}, ${over.kind}, ${over.value ?? '0'}, ${over.minOrderTotal ?? '0'},
        ${over.usageLimit ?? null}, ${over.perCustomerLimit ?? null},
        ${over.bogoBuyQty ?? null}, ${over.bogoPayQty ?? null},
        ${over.applyScope ?? 'cart'}, ${over.minQty ?? null},
        ${over.giftProductId ?? null}, ${over.giftVariantId ?? null}, ${over.giftQty ?? null}, true
      )
      RETURNING id
    `;
    created.promoIds.push(r!.id);
    return r!.id;
  }

  /** Привязывает товар к категории (для scope='category' таргетинга). */
  async function linkProductCategory(productId: string, categoryId: string): Promise<void> {
    await sql`
      INSERT INTO product_categories (product_id, category_id, is_primary)
      VALUES (${productId}, ${categoryId}, true)
      ON CONFLICT DO NOTHING
    `;
  }

  /** Создаёт категорию и возвращает её id. */
  async function makeCategory(): Promise<string> {
    const suffix = Math.random().toString(36).slice(2, 10);
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO categories (slug, name)
      VALUES (${'cat-' + suffix}, ${'Cat ' + suffix})
      RETURNING id
    `;
    created.categoryIds.push(c!.id);
    return c!.id;
  }

  /** Добавляет таргет акции (category). */
  async function addCategoryTarget(promoId: string, categoryId: string): Promise<void> {
    await sql`
      INSERT INTO promo_targets (promo_code_id, target_type, category_id)
      VALUES (${promoId}, 'category', ${categoryId})
      ON CONFLICT DO NOTHING
    `;
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
    await sql`DELETE FROM orders WHERE customer_email IN ('buyer@example.com','race@example.com','limit@example.com','percust@example.com','percustrace@example.com','gift@example.com')`;
    for (const id of created.promoIds) {
      await sql`DELETE FROM promo_codes WHERE id = ${id}`;
    }
    for (const id of created.productIds) {
      await sql`DELETE FROM inventory WHERE product_id = ${id}`;
      await sql`DELETE FROM product_categories WHERE product_id = ${id}`;
      await sql`DELETE FROM products WHERE id = ${id}`;
    }
    for (const id of created.categoryIds) {
      await sql`DELETE FROM categories WHERE id = ${id}`;
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

  it('quoteCart применяет bogo «3 по 2» (1 единица из 3 бесплатна)', async () => {
    const productId = await makeProduct({ basePrice: '100.00', quantity: 10 });
    await makePromo({
      code: 'BOGO32',
      kind: 'bogo',
      bogoBuyQty: 3,
      bogoPayQty: 2,
      applyScope: 'cart',
    });
    const res = await repo.quoteCart({
      items: [{ productId, qty: 3 }],
      promoCode: 'BOGO32',
    });
    expect(res.promo?.valid).toBe(true);
    // 3 × 100, floor(3/3)=1 группа, бесплатна 1 самая дешёвая → discount 100.
    expect(res.quote.promo.discount).toBe('100.00');
    expect(res.quote.discount).toBe('100.00');
    expect(res.quote.grandTotal).toBe('200.00');
  });

  it('quoteCart: scope=category применяет percent только к товарам категории', async () => {
    const categoryId = await makeCategory();
    const inCat = await makeProduct({ basePrice: '1000.00', quantity: 10 });
    const outCat = await makeProduct({ basePrice: '1000.00', quantity: 10 });
    await linkProductCategory(inCat, categoryId);
    const promoId = await makePromo({
      code: 'CAT10',
      kind: 'percent',
      value: '10',
      applyScope: 'category',
    });
    await addCategoryTarget(promoId, categoryId);

    const res = await repo.quoteCart({
      items: [
        { productId: inCat, qty: 1 },
        { productId: outCat, qty: 1 },
      ],
      promoCode: 'CAT10',
    });
    expect(res.promo?.valid).toBe(true);
    // 10% только от товара в категории (1000) = 100; товар вне scope не дисконтируется.
    expect(res.quote.discount).toBe('100.00');
    expect(res.quote.itemsTotal).toBe('2000.00');
    expect(res.quote.grandTotal).toBe('1900.00');
  });

  it('createOrder пишет реальный discount_applied (рубли через fromMinor) для bogo + инкремент used_count', async () => {
    const productId = await makeProduct({ basePrice: '100.00', quantity: 10 });
    const promoId = await makePromo({
      code: 'BOGOORDER',
      kind: 'bogo',
      bogoBuyQty: 3,
      bogoPayQty: 2,
      applyScope: 'cart',
    });
    const r = await repo.createOrder({
      items: [{ productId, qty: 3 }],
      customer: customer(),
      delivery: { type: 'courier' },
      paymentMethod: 'cod',
      promoCode: 'BOGOORDER',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    created.orderIds.push(r.order.id);

    // discount_total в рублях (numeric), не копейки.
    expect(r.order.discountTotal).toBe('100.00');
    expect(r.order.grandTotal).toBe('200.00');

    // promo_redemptions.discount_applied — рубли через fromMinor.
    const [red] = await sql<{ discount_applied: string }[]>`
      SELECT discount_applied FROM promo_redemptions WHERE order_id = ${r.order.id}
    `;
    expect(red!.discount_applied).toBe('100.00');

    // used_count инкрементирован атомарно.
    const [pc] = await sql<{ used_count: number }[]>`
      SELECT used_count FROM promo_codes WHERE id = ${promoId}
    `;
    expect(Number(pc!.used_count)).toBe(1);
  });

  it('anti-tamper: scope определяется сервером из каталога (товар вне категории не дисконтируется)', async () => {
    const categoryId = await makeCategory();
    const outCat = await makeProduct({ basePrice: '500.00', quantity: 10 });
    const promoId = await makePromo({
      code: 'CATANTI',
      kind: 'percent',
      value: '50',
      applyScope: 'category',
    });
    await addCategoryTarget(promoId, categoryId);

    // Товар НЕ привязан к категории-таргету → скидки быть не должно.
    const res = await repo.quoteCart({
      items: [{ productId: outCat, qty: 1 }],
      promoCode: 'CATANTI',
    });
    expect(res.promo?.valid).toBe(true);
    expect(res.quote.discount).toBe('0.00');
    expect(res.quote.promo.applied).toBe(false);
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

  it('per_customer_limit: второй заказ того же покупателя отклоняется (последовательно)', async () => {
    const productId = await makeProduct({ basePrice: '1000.00', quantity: 10 });
    await makePromo({
      code: 'PERCUST1',
      kind: 'fixed',
      value: '100.00',
      perCustomerLimit: 1,
    });
    const mk = () =>
      repo.createOrder({
        items: [{ productId, qty: 1 }],
        customer: customer('percust@example.com'),
        delivery: { type: 'courier' },
        paymentMethod: 'cod',
        promoCode: 'PERCUST1',
      });
    const a = await mk();
    expect(a.ok).toBe(true);
    if (a.ok) created.orderIds.push(a.order.id);
    const b = await mk();
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe('invalid_promo');
  });

  it('per_customer_limit: гонка двух одновременных чекаутов одного email — проходит ровно один (N1)', async () => {
    const productId = await makeProduct({ basePrice: '1000.00', quantity: 10 });
    await makePromo({
      code: 'PERCUSTRACE',
      kind: 'fixed',
      value: '100.00',
      perCustomerLimit: 1,
    });
    const mk = () =>
      repo.createOrder({
        items: [{ productId, qty: 1 }],
        customer: customer('percustrace@example.com'),
        delivery: { type: 'courier' },
        paymentMethod: 'cod',
        promoCode: 'PERCUSTRACE',
      });
    const [a, b] = await Promise.all([mk(), mk()]);
    const oks = [a, b].filter((x) => x.ok);
    // Ровно один заказ проходит, второй отклонён по per_customer_limit.
    expect(oks).toHaveLength(1);
    for (const x of [a, b]) if (x.ok) created.orderIds.push(x.order.id);
    const rejected = [a, b].find((x) => !x.ok);
    if (rejected && !rejected.ok) expect(rejected.code).toBe('invalid_promo');
  });

  it('createOrder выдаёт подарок (gift_*) строкой is_gift с ценой 0 + резервирует подарок (ADR-016)', async () => {
    const buyProduct = await makeProduct({ basePrice: '1000.00', quantity: 10 });
    const giftProduct = await makeProduct({ basePrice: '300.00', quantity: 5 });
    await makePromo({
      code: 'GIFTPROMO',
      kind: 'fixed',
      value: '100.00',
      giftProductId: giftProduct,
      giftQty: 1,
    });
    const r = await repo.createOrder({
      items: [{ productId: buyProduct, qty: 1 }],
      customer: customer('gift@example.com'),
      delivery: { type: 'courier' },
      paymentMethod: 'cod',
      promoCode: 'GIFTPROMO',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    created.orderIds.push(r.order.id);

    // Подарок — отдельная строка is_gift, цена и сумма 0, qty=1.
    const detail = await repo.getOrderById(r.order.id);
    const gift = detail?.items.find((i) => i.isGift);
    expect(gift).toBeTruthy();
    expect(gift?.unitPrice).toBe('0.00');
    expect(gift?.lineTotal).toBe('0.00');
    expect(gift?.quantity).toBe(1);
    // Обычная позиция осталась платной.
    expect(detail?.items.filter((i) => !i.isGift)).toHaveLength(1);

    // Подарок зарезервирован (анти-оверселл).
    const [inv] = await sql<{ reserved: number }[]>`
      SELECT reserved FROM inventory WHERE product_id = ${giftProduct} AND warehouse_code = 'main'
    `;
    expect(Number(inv!.reserved)).toBe(1);

    // Итог НЕ включает подарок: 1000 − 100 скидки + 0 = 900.
    expect(r.order.itemsTotal).toBe('1000.00');
    expect(r.order.discountTotal).toBe('100.00');
    expect(r.order.grandTotal).toBe('900.00');
  });

  it('createOrder: подарок без остатка → заказ создаётся БЕЗ подарка (best-effort)', async () => {
    const buyProduct = await makeProduct({ basePrice: '1000.00', quantity: 10 });
    const giftProduct = await makeProduct({ basePrice: '300.00', quantity: 0 });
    await makePromo({
      code: 'GIFTNOSTOCK',
      kind: 'fixed',
      value: '100.00',
      giftProductId: giftProduct,
      giftQty: 1,
    });
    const r = await repo.createOrder({
      items: [{ productId: buyProduct, qty: 1 }],
      customer: customer('gift@example.com'),
      delivery: { type: 'courier' },
      paymentMethod: 'cod',
      promoCode: 'GIFTNOSTOCK',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    created.orderIds.push(r.order.id);
    // Подарок не выдан, заказ создан и оплачиваем.
    const detail = await repo.getOrderById(r.order.id);
    expect(detail?.items.some((i) => i.isGift)).toBe(false);
    expect(detail?.items).toHaveLength(1);
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
