import Link from 'next/link';

import { Forbidden } from '../../../_components/Forbidden';
import { guardCatalog } from '../../_components/guard';
import { BrandForm } from '../../_components/BrandForm';

/**
 * Создание бренда (docs/06 §3.3, П4.4). Доступ — catalog.write; создаёт через
 * createBrand. Логотип загружается после создания (нужен brandId).
 *
 * force-dynamic: читает cookies — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

export default async function NewBrandPage() {
  const guard = await guardCatalog('catalog.write');
  if (!guard.ok) {
    if (guard.reason === 'module_disabled') {
      return <Forbidden permission="catalog (модуль выключен)" />;
    }
    return <Forbidden permission={guard.permission} />;
  }

  return (
    <div>
      <nav className="text-sm text-gray-500" aria-label="Хлебные крошки">
        <Link href="/admin/catalog/brands" className="text-blue-700 hover:underline">
          Бренды
        </Link>{' '}
        / Новый бренд
      </nav>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Новый бренд</h1>
      <p className="mt-1 text-sm text-gray-600">
        После создания станет доступна загрузка логотипа.
      </p>

      <div className="mt-6">
        <BrandForm brand={null} />
      </div>
    </div>
  );
}
