import Link from 'next/link';

import { listBrands, getCategoryTree, listAttributes } from '@/lib/catalog/repository';

import { Forbidden } from '../../../_components/Forbidden';
import { guardCatalog } from '../../_components/guard';
import { ProductForm } from '../../_components/ProductForm';

/**
 * Создание товара (docs/05 §5.1, П4.2). Доступ к странице — catalog.read;
 * сам сабмит создаёт через createProduct (catalog.write).
 *
 * force-dynamic: читает БД/cookies — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  const guard = await guardCatalog('catalog.write');
  if (!guard.ok) {
    if (guard.reason === 'module_disabled') {
      return <Forbidden permission="catalog (модуль выключен)" />;
    }
    return <Forbidden permission={guard.permission} />;
  }

  const [brands, categoryTree, attributes] = await Promise.all([
    listBrands(),
    getCategoryTree(),
    listAttributes(),
  ]);

  return (
    <div>
      <nav className="text-sm text-gray-500" aria-label="Хлебные крошки">
        <Link href="/admin/catalog" className="text-blue-700 hover:underline">
          Каталог
        </Link>{' '}
        / Новый товар
      </nav>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Новый товар</h1>
      <p className="mt-1 text-sm text-gray-600">
        Заполните основные поля и создайте товар. Варианты, характеристики, медиа
        и остатки станут доступны после создания.
      </p>

      <div className="mt-6">
        <ProductForm
          product={null}
          brands={brands}
          categoryTree={categoryTree}
          attributes={attributes}
        />
      </div>
    </div>
  );
}
