import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  getProductById,
  listBrands,
  getCategoryTree,
  listAttributes,
} from '@/lib/catalog/repository';
import { can } from '@/lib/auth/rbac';

import { Forbidden } from '../../../_components/Forbidden';
import { guardCatalog } from '../../_components/guard';
import { ProductForm } from '../../_components/ProductForm';

/**
 * Карточка товара (docs/05 §5.3, П4.2). Чтение — catalog.read; правки —
 * catalog.write (проверяется и в Server Action). Если права записи нет —
 * показываем форму в режиме «только чтение» недоступна: проще показать Forbidden
 * на мутации; здесь рендерим форму, а сервер отклонит запись без права.
 *
 * force-dynamic: читает БД/cookies — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({
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
  const [product, brands, categoryTree, attributes] = await Promise.all([
    getProductById(id),
    listBrands(),
    getCategoryTree(),
    listAttributes(),
  ]);

  if (!product) {
    notFound();
  }

  const canWrite = can(guard.user, 'catalog.write');

  return (
    <div>
      <nav className="text-sm text-gray-500" aria-label="Хлебные крошки">
        <Link href="/admin/catalog" className="text-blue-700 hover:underline">
          Каталог
        </Link>{' '}
        / {product.name}
      </nav>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">{product.name}</h1>
        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
          {product.sku}
        </code>
      </div>

      {!canWrite ? (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
          У вас нет права <code>catalog.write</code> — изменения будут отклонены сервером.
        </p>
      ) : null}

      <div className="mt-6">
        <ProductForm
          product={product}
          brands={brands}
          categoryTree={categoryTree}
          attributes={attributes}
        />
      </div>
    </div>
  );
}
