import Link from 'next/link';

import { getCategoryTree } from '@/lib/catalog/repository';

import { Forbidden } from '../../_components/Forbidden';
import { guardCatalog } from '../_components/guard';
import { CategoryManager } from '../_components/CategoryManager';

/**
 * Дерево категорий (docs/05 §5.4, П4.3). Чтение — catalog.read; CRUD/move/delete —
 * через Server Actions (catalog.write на сервере). Защита от циклов и RESTRICT —
 * на бэке (moveCategory/deleteCategory).
 *
 * force-dynamic: читает БД/cookies — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const guard = await guardCatalog('catalog.read');
  if (!guard.ok) {
    if (guard.reason === 'module_disabled') {
      return <Forbidden permission="catalog (модуль выключен)" />;
    }
    return <Forbidden permission={guard.permission} />;
  }

  const tree = await getCategoryTree();

  return (
    <div>
      <nav className="text-sm text-gray-500" aria-label="Хлебные крошки">
        <Link href="/admin/catalog" className="text-blue-700 hover:underline">
          Каталог
        </Link>{' '}
        / Категории
      </nav>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Категории</h1>
      <p className="mt-1 text-sm text-gray-600">
        Дерево категорий: создание, переименование, перемещение и удаление.
        Категорию с подкатегориями удалить нельзя — сначала перенесите/удалите детей.
      </p>

      <div className="mt-6">
        <CategoryManager tree={tree} />
      </div>
    </div>
  );
}
