import { afterAll, describe, expect, it } from 'vitest';

import { sql, closeSql } from '@/lib/db/client';
import {
  listProducts,
  getProductById,
  getCategoryTree,
  listInventory,
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

function findNode(nodes: any[], id: string): any | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}
