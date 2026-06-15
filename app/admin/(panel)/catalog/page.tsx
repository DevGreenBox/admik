import Link from 'next/link';

import { getEnv } from '@/lib/config/env';
import {
  listProducts,
  listBrands,
  getCategoryTree,
  type ProductListFilter,
  type ProductSort,
} from '@/lib/catalog/repository';
import { PRODUCT_STATUSES, type ProductStatus } from '@/lib/catalog/types';

import { Forbidden } from '../_components/Forbidden';
import { guardCatalog } from './_components/guard';
import { ProductFilters } from './_components/ProductFilters';
import { PriceCell } from './_components/PriceCell';
import {
  StatusBadge,
  NewBadge,
  FeaturedBadge,
} from './_components/Badges';

/**
 * Список товаров каталога (docs/05 §5.2, П4.1).
 *
 * Серверная загрузка через listProducts: фильтры/поиск/пагинация — из
 * searchParams (URL = состояние, shareable). Колонки: фото, название, SKU,
 * бренд, цена (со старой ценой и бейджем скидки%), статус, флаги New|Хит,
 * остаток. Доступ — серверный (guardCatalog: модуль + catalog.read).
 *
 * force-dynamic: читает БД/cookies — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

/** searchParams → строго типизированный фильтр listProducts. */
function parseFilter(
  sp: Record<string, string | string[] | undefined>,
): ProductListFilter {
  const one = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const status = one('status');
  const sort = one('sort');
  const page = Number(one('page') ?? '1');
  return {
    search: one('search') || undefined,
    status: PRODUCT_STATUSES.includes(status as ProductStatus)
      ? (status as ProductStatus)
      : undefined,
    brandId: one('brandId') || undefined,
    categoryId: one('categoryId') || undefined,
    isFeatured: one('isFeatured') === '1' ? true : undefined,
    isNew: one('isNew') === '1' ? true : undefined,
    onSale: one('onSale') === '1' ? true : undefined,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pageSize: PAGE_SIZE,
    sort: (['created_desc', 'name_asc', 'price_asc', 'price_desc'] as ProductSort[]).includes(
      sort as ProductSort,
    )
      ? (sort as ProductSort)
      : 'created_desc',
  };
}

/** Сохраняет текущие фильтры, меняя только page (для ссылок пагинации). */
function pageHref(
  sp: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'page') continue;
    const value = Array.isArray(v) ? v[0] : v;
    if (value) next.set(k, value);
  }
  next.set('page', String(page));
  return `/admin/catalog?${next.toString()}`;
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await guardCatalog('catalog.read');
  if (!guard.ok) {
    if (guard.reason === 'module_disabled') {
      return <Forbidden permission="catalog (модуль выключен)" />;
    }
    return <Forbidden permission={guard.permission} />;
  }

  const sp = await searchParams;
  const filter = parseFilter(sp);
  const currency = getEnv().SHOP_CURRENCY;

  const [{ rows, total }, brands, categoryTree] = await Promise.all([
    listProducts(filter),
    listBrands(),
    getCategoryTree(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(filter.page, totalPages);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Каталог — товары</h1>
          <p className="mt-1 text-sm text-gray-600">
            Найдено товаров: {total}. Цены в {currency}.
          </p>
        </div>
        <Link
          href="/admin/catalog/products/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Создать товар
        </Link>
      </div>

      <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Разделы каталога">
        <Link href="/admin/catalog/categories" className="text-blue-700 hover:underline">
          Категории
        </Link>
        <span className="text-gray-300">·</span>
        <Link href="/admin/catalog/brands" className="text-blue-700 hover:underline">
          Бренды
        </Link>
      </nav>

      <div className="mt-4">
        <ProductFilters brands={brands} categoryTree={categoryTree} />
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Фото</th>
              <th scope="col" className="px-4 py-2 font-medium">Название</th>
              <th scope="col" className="px-4 py-2 font-medium">Артикул</th>
              <th scope="col" className="px-4 py-2 font-medium">Бренд</th>
              <th scope="col" className="px-4 py-2 font-medium">Цена</th>
              <th scope="col" className="px-4 py-2 font-medium">Статус</th>
              <th scope="col" className="px-4 py-2 font-medium">Флаги</th>
              <th scope="col" className="px-4 py-2 font-medium">Остаток</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                  Товары не найдены. Измените фильтры или создайте товар.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    {row.primaryMediaUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.primaryMediaUrl}
                        alt=""
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded bg-gray-100 text-xs text-gray-400"
                        aria-hidden="true"
                      >
                        —
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/catalog/products/${row.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    <code className="text-xs">{row.sku}</code>
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {row.brand?.name ?? '—'}
                  </td>
                  <td className="px-4 py-2">
                    <PriceCell
                      price={row.basePrice}
                      compareAt={row.compareAtPrice}
                      discountPct={row.discountPct}
                      currency={currency}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.effectiveIsNew ? <NewBadge /> : null}
                      {row.isFeatured ? <FeaturedBadge /> : null}
                      {!row.effectiveIsNew && !row.isFeatured ? (
                        <span className="text-gray-400">—</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-gray-700">{row.totalStock}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav
          className="mt-4 flex items-center justify-between text-sm"
          aria-label="Пагинация"
        >
          <span className="text-gray-500">
            Страница {currentPage} из {totalPages}
          </span>
          <div className="flex gap-2">
            {currentPage > 1 ? (
              <Link
                href={pageHref(sp, currentPage - 1)}
                className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-100"
              >
                Назад
              </Link>
            ) : null}
            {currentPage < totalPages ? (
              <Link
                href={pageHref(sp, currentPage + 1)}
                className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-100"
              >
                Вперёд
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
