/**
 * GET /api/storefront/v1/products — публичный список товаров (ADR-008, docs/06 §6).
 *
 * Query: q (поиск), brand (slug? — нет; здесь brandId через ?brandId), category
 * (categoryId), featured, new, sale (булевы фасеты), limit/offset (пагинация).
 * Отдаёт только status='active' товары. Цены/скидки — готовые из pricing.
 */

import { runStorefront, jsonData, handlePreflight } from '@/lib/storefront/response';
import { listProducts } from '@/lib/catalog/repository';
import type { ProductListFilter } from '@/lib/catalog/repository';
import { toProductListItemDto } from '@/lib/storefront/dto';

export const dynamic = 'force-dynamic';

function parseBool(v: string | null): boolean | undefined {
  if (v === null) return undefined;
  if (v === '1' || v.toLowerCase() === 'true') return true;
  if (v === '0' || v.toLowerCase() === 'false') return false;
  return undefined;
}

function parseIntOr(v: string | null, def: number): number {
  if (v === null) return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export async function GET(req: Request): Promise<Response> {
  return runStorefront(req, async ({ cors }) => {
    const url = new URL(req.url);
    const q = url.searchParams;

    const limit = Math.min(100, Math.max(1, parseIntOr(q.get('limit'), 24)));
    const offset = Math.max(0, parseIntOr(q.get('offset'), 0));
    const page = Math.floor(offset / limit) + 1;

    const filter: ProductListFilter = {
      search: q.get('q') ?? undefined,
      // Витрине отдаём только опубликованные товары.
      status: 'active',
      brandId: q.get('brandId') ?? undefined,
      categoryId: q.get('categoryId') ?? undefined,
      isFeatured: parseBool(q.get('featured')),
      isNew: parseBool(q.get('new')),
      onSale: parseBool(q.get('sale')),
      page,
      pageSize: limit,
    };

    const { rows, total } = await listProducts(filter);
    const data = rows.map(toProductListItemDto);

    return jsonData(
      data,
      { pagination: { total, limit, offset, count: data.length } },
      cors,
    );
  });
}

export async function OPTIONS(req: Request): Promise<Response> {
  return handlePreflight(req);
}
