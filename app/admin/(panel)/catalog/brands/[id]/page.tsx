import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getBrandById } from '@/lib/catalog/repository';

import { Forbidden } from '../../../_components/Forbidden';
import { guardCatalog } from '../../_components/guard';
import { BrandForm } from '../../_components/BrandForm';

/**
 * Карточка бренда (docs/06 §3.3, П4.4). Чтение — catalog.read; правки/лого —
 * catalog.write (проверяется в Server Action).
 *
 * force-dynamic: читает БД/cookies — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

export default async function BrandDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await guardCatalog('catalog.read');
  if (!guard.ok) {
    if (guard.reason === 'module_disabled') {
      return <Forbidden permission="catalog (модуль выключен)" />;
    }
    return <Forbidden permission={guard.permission} />;
  }

  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand) {
    notFound();
  }

  return (
    <div>
      <nav className="text-sm text-gray-500" aria-label="Хлебные крошки">
        <Link href="/admin/catalog/brands" className="text-blue-700 hover:underline">
          Бренды
        </Link>{' '}
        / {brand.name}
      </nav>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">{brand.name}</h1>

      <div className="mt-6">
        <BrandForm brand={brand} />
      </div>
    </div>
  );
}
