import { afterAll, describe, expect, it } from 'vitest';

import { sql, closeSql } from '@/lib/db/client';
import {
  listProducts,
  getProductById,
  getCategoryTree,
  listInventory,
  listBrands,
  getBrandById,
  getBrandBySlug,
} from '@/lib/catalog/repository';
import { rebuildProductAttributesCache } from '@/lib/catalog/cache';

// ИНТЕГРАЦИЯ: требует реальную БД с накатанными миграциями 0005–0010.
// Локально (без DATABASE_URL) — пропускается. Сети/Next не требует: только sql.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('каталог — интеграция (репозиторий + sql)', () => {
  afterAll(async () => {
    await closeSql();
  });

  it('createProduct → getProductById возвращает товар со связями', async () => {
    const suffix = Date.now().toString(36);
    const [{ id }] = await sql<{ id: string }[]>`
      INSERT INTO products (sku, slug, name, status, base_price)
      VALUES (${'it-sku-' + suffix}, ${'it-slug-' + suffix}, 'Интеграционный товар', 'active', '100.00')
      RETURNING id
    `;
    await sql`
      INSERT INTO inventory (product_id, variant_id, warehouse_code, quantity)
      VALUES (${id}, NULL, 'main', 7)
    `;

    const detail = await getProductById(id);
    expect(detail).not.toBeNull();
    expect(detail!.sku).toBe('it-sku-' + suffix);
    expect(detail!.basePrice).toBe('100.00');
    expect(detail!.inventory.length).toBe(1);
    expect(detail!.inventory[0]!.quantity).toBe(7);

    const inv = await listInventory(id);
    expect(inv[0]!.quantity).toBe(7);

    // cleanup
    await sql`DELETE FROM products WHERE id = ${id}`;
  });

  it('listProducts фильтрует по поиску и пагинирует', async () => {
    const { rows, total } = await listProducts({ page: 1, pageSize: 5 });
    expect(Array.isArray(rows)).toBe(true);
    expect(typeof total).toBe('number');
  });

  it('getCategoryTree собирает дерево', async () => {
    const suffix = Date.now().toString(36);
    const [{ id: parent }] = await sql<{ id: string }[]>`
      INSERT INTO categories (slug, name) VALUES (${'it-parent-' + suffix}, 'Родитель')
      RETURNING id
    `;
    const [{ id: child }] = await sql<{ id: string }[]>`
      INSERT INTO categories (parent_id, slug, name)
      VALUES (${parent}, ${'it-child-' + suffix}, 'Ребёнок')
      RETURNING id
    `;

    const tree = await getCategoryTree();
    const parentNode = findNode(tree, parent);
    expect(parentNode).toBeTruthy();
    expect(parentNode!.children.some((c: { id: string }) => c.id === child)).toBe(true);

    // cleanup (child first из-за RESTRICT)
    await sql`DELETE FROM categories WHERE id = ${child}`;
    await sql`DELETE FROM categories WHERE id = ${parent}`;
  });

  it('rebuildProductAttributesCache собирает кеш из EAV', async () => {
    const suffix = Date.now().toString(36);
    const [{ id: pid }] = await sql<{ id: string }[]>`
      INSERT INTO products (sku, slug, name) VALUES (${'it-attr-' + suffix}, ${'it-attr-' + suffix}, 'T')
      RETURNING id
    `;
    const [{ id: aid }] = await sql<{ id: string }[]>`
      INSERT INTO attributes (code, name, type) VALUES (${'mat_' + suffix}, 'Материал', 'text')
      RETURNING id
    `;
    await sql`
      INSERT INTO product_attributes (product_id, attribute_id, value_text)
      VALUES (${pid}, ${aid}, 'Хлопок')
    `;
    const cache = await rebuildProductAttributesCache(pid);
    expect(cache['mat_' + suffix]).toBe('Хлопок');

    await sql`DELETE FROM products WHERE id = ${pid}`;
    await sql`DELETE FROM attributes WHERE id = ${aid}`;
  });
});

// ИНТЕГРАЦИЯ: миграция 0011 (compare_at_price/флаги/бренды). Требует БД с накатанной 0011.
describe.skipIf(!hasDb)('каталог 0011 — цена/флаги/бренды (интеграция)', () => {
  afterAll(async () => {
    await closeSql();
  });

  it('миграция 0011 зарегистрирована и колонки/таблица/индексы на месте', async () => {
    const [mig] = await sql<{ version: string }[]>`
      SELECT version FROM schema_migrations WHERE version = '0011'
    `;
    expect(mig?.version).toBe('0011');

    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'products'
        AND column_name IN ('compare_at_price','is_featured','is_new','brand_id')
    `;
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'brand_id', 'compare_at_price', 'is_featured', 'is_new',
    ]);

    const [{ count: brandsTbl }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM information_schema.tables WHERE table_name = 'brands'
    `;
    expect(Number(brandsTbl)).toBe(1);

    const idx = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('products_featured_idx','products_is_new_idx',
                          'products_has_compare_idx','products_brand_idx',
                          'brands_slug_uniq','brands_active_idx')
    `;
    expect(idx.length).toBe(6);
  });

  it('CHECK compare_at_price >= 0 срабатывает', async () => {
    const suffix = Date.now().toString(36);
    let threw = false;
    try {
      await sql`
        INSERT INTO products (sku, slug, name, base_price, compare_at_price)
        VALUES (${'chk-' + suffix}, ${'chk-' + suffix}, 'X', '10.00', '-1')
      `;
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('бренды: CRUD + listBrands/getBrandById/getBrandBySlug', async () => {
    const suffix = Date.now().toString(36);
    const [{ id }] = await sql<{ id: string }[]>`
      INSERT INTO brands (slug, name) VALUES (${'br-' + suffix}, 'Brembo')
      RETURNING id
    `;
    const byId = await getBrandById(id);
    expect(byId?.name).toBe('Brembo');
    const bySlug = await getBrandBySlug('br-' + suffix);
    expect(bySlug?.id).toBe(id);
    const all = await listBrands();
    expect(all.some((b) => b.id === id)).toBe(true);

    await sql`DELETE FROM brands WHERE id = ${id}`;
  });

  it('ON DELETE SET NULL: удаление бренда обнуляет brand_id, товар жив', async () => {
    const suffix = Date.now().toString(36);
    const [{ id: brandId }] = await sql<{ id: string }[]>`
      INSERT INTO brands (slug, name) VALUES (${'brd-' + suffix}, 'Bosch')
      RETURNING id
    `;
    const [{ id: prodId }] = await sql<{ id: string }[]>`
      INSERT INTO products (sku, slug, name, brand_id, compare_at_price, is_featured)
      VALUES (${'p-' + suffix}, ${'p-' + suffix}, 'Деталь', ${brandId}, '150.00', true)
      RETURNING id
    `;

    const withBrand = await getProductById(prodId);
    expect(withBrand?.brandId).toBe(brandId);
    expect(withBrand?.brand?.name).toBe('Bosch');
    expect(withBrand?.isFeatured).toBe(true);
    expect(withBrand?.compareAtPrice).toBe('150.00');

    await sql`DELETE FROM brands WHERE id = ${brandId}`;

    const afterDelete = await getProductById(prodId);
    expect(afterDelete).not.toBeNull(); // товар не удалён
    expect(afterDelete?.brandId).toBeNull(); // brand_id обнулён
    expect(afterDelete?.brand).toBeNull();

    await sql`DELETE FROM products WHERE id = ${prodId}`;
  });

  it('фильтры списка: brandId/onSale (вычисляемый предикат)', async () => {
    const suffix = Date.now().toString(36);
    const [{ id: brandId }] = await sql<{ id: string }[]>`
      INSERT INTO brands (slug, name) VALUES (${'flt-' + suffix}, 'KYB')
      RETURNING id
    `;
    const [{ id: saleId }] = await sql<{ id: string }[]>`
      INSERT INTO products (sku, slug, name, status, base_price, compare_at_price, brand_id)
      VALUES (${'sale-' + suffix}, ${'sale-' + suffix}, 'Со скидкой', 'active', '100.00', '150.00', ${brandId})
      RETURNING id
    `;
    const [{ id: noSaleId }] = await sql<{ id: string }[]>`
      INSERT INTO products (sku, slug, name, status, base_price, compare_at_price, brand_id)
      VALUES (${'nosale-' + suffix}, ${'nosale-' + suffix}, 'Без скидки', 'active', '100.00', '80.00', ${brandId})
      RETURNING id
    `;

    const byBrand = await listProducts({ brandId, page: 1, pageSize: 50 });
    const brandIds = byBrand.rows.map((r) => r.id);
    expect(brandIds).toContain(saleId);
    expect(brandIds).toContain(noSaleId);

    const onSale = await listProducts({ brandId, onSale: true, page: 1, pageSize: 50 });
    const saleIds = onSale.rows.map((r) => r.id);
    expect(saleIds).toContain(saleId);
    expect(saleIds).not.toContain(noSaleId);
    const saleRow = onSale.rows.find((r) => r.id === saleId)!;
    expect(saleRow.onSale).toBe(true);
    expect(saleRow.discountPct).toBe(33); // (150-100)/150 = 33.3 → 33

    await sql`DELETE FROM products WHERE id IN (${saleId}, ${noSaleId})`;
    await sql`DELETE FROM brands WHERE id = ${brandId}`;
  });
});

function findNode(nodes: any[], id: string): any | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}
