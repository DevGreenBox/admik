import Link from 'next/link';

import { listBrands } from '@/lib/catalog/repository';

import { Forbidden } from '../../_components/Forbidden';
import { guardCatalog } from '../_components/guard';
import { BrandList } from '../_components/BrandList';

/**
 * Список брендов (docs/06 §3.3, П4.4). Чтение — catalog.read; CRUD —
 * через Server Actions (catalog.write на сервере).
 *
 * force-dynamic: читает БД/cookies — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

export default async function BrandsPage() {
  const guard = await guardCatalog('catalog.read');
  if (!guard.ok) {
    if (guard.reason === 'module_disabled') {
      return <Forbidden permission="catalog (модуль выключен)" />;
    }
    return <Forbidden permission={guard.permission} />;
  }

  const brands = await listBrands();

  return (
    <div>
      <nav className="text-sm text-gray-500" aria-label="Хлебные крошки">
        <Link href="/admin/catalog" className="text-blue-700 hover:underline">
          Каталог
        </Link>{' '}
        / Бренды
      </nav>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Бренды</h1>
          <p className="mt-1 text-sm text-gray-600">
            Производители для фасетного фильтра и страниц бренда. Опционально —
            магазин без брендов оставляет список пустым.
          </p>
        </div>
        <Link
          href="/admin/catalog/brands/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Создать бренд
        </Link>
      </div>

      <div className="mt-6">
        <BrandList brands={brands} />
      </div>
    </div>
  );
}
