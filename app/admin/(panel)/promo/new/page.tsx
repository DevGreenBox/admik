import Link from 'next/link';

import { Forbidden } from '../../_components/Forbidden';
import { guardOrders } from '../../orders/_components/guard';
import { PromoForm } from '../_components/PromoForm';

/**
 * Создание промокода (docs/07 §5). Право orders.write (guardOrders). Форма —
 * PromoForm в режиме создания (createPromoCode на сервере).
 *
 * force-dynamic: гвард читает cookie/БД — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

export default async function NewPromoPage() {
  const guard = await guardOrders('orders.write');
  if (!guard.ok) {
    if (guard.reason === 'module_disabled') {
      return <Forbidden permission="orders (модуль выключен)" />;
    }
    return <Forbidden permission={guard.permission} />;
  }

  return (
    <div className="max-w-3xl">
      <nav className="text-sm" aria-label="Хлебные крошки">
        <Link href="/admin/promo" className="text-blue-700 hover:underline">
          Промокоды
        </Link>
        <span className="mx-1 text-gray-400">/</span>
        <span className="text-gray-600">Новый</span>
      </nav>
      <h1 className="mt-2 text-2xl font-semibold text-gray-900">Новый промокод</h1>
      <div className="mt-6">
        <PromoForm promo={null} />
      </div>
    </div>
  );
}
