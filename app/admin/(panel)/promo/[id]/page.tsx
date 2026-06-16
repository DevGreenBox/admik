import Link from 'next/link';

import { sql } from '@/lib/db/client';
import { mapPromoCode } from '@/lib/orders/repository';
import type { PromoCode, PromoTarget } from '@/lib/orders/types';

import { Forbidden } from '../../_components/Forbidden';
import { guardOrders } from '../../orders/_components/guard';
import { PromoForm } from '../_components/PromoForm';

/**
 * Редактирование промокода (docs/07 §5). Право orders.write. Загрузка — прямой
 * параметризованный sql по id (репозиторий не экспортирует getPromoById; маппер
 * строки→домен переиспользуется из repository.mapPromoCode). Форма — PromoForm в
 * режиме редактирования (updatePromoCode на сервере). Показывает used_count.
 *
 * force-dynamic: читает БД/cookies — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

async function loadPromo(id: string): Promise<PromoCode | null> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, code, kind, value, min_order_total, max_discount, usage_limit,
           per_customer_limit, used_count, starts_at, ends_at, is_active,
           bogo_buy_qty, bogo_pay_qty, apply_scope, priority, stackable, min_qty,
           gift_product_id, gift_variant_id, gift_qty, comment, created_at, updated_at
    FROM promo_codes WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ? mapPromoCode(rows[0]) : null;
}

/** Таргеты промокода (для предзаполнения мультиселекта в форме). */
async function loadPromoTargets(id: string): Promise<PromoTarget[]> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT id, promo_code_id, target_type, category_id, brand_id, product_id, variant_id, created_at
    FROM promo_targets WHERE promo_code_id = ${id}
    ORDER BY created_at, id
  `;
  return rows.map((r) => ({
    id: String(r.id),
    promoCodeId: String(r.promo_code_id),
    targetType: r.target_type as PromoTarget['targetType'],
    categoryId: r.category_id != null ? String(r.category_id) : null,
    brandId: r.brand_id != null ? String(r.brand_id) : null,
    productId: r.product_id != null ? String(r.product_id) : null,
    variantId: r.variant_id != null ? String(r.variant_id) : null,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at)),
  }));
}

export default async function EditPromoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await guardOrders('orders.write');
  if (!guard.ok) {
    if (guard.reason === 'module_disabled') {
      return <Forbidden permission="orders (модуль выключен)" />;
    }
    return <Forbidden permission={guard.permission} />;
  }

  const { id } = await params;
  const promo = await loadPromo(id);
  const targets = promo ? await loadPromoTargets(id) : [];
  if (!promo) {
    return (
      <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-xl font-semibold text-amber-800">Промокод не найден</h1>
        <p className="mt-2 text-sm text-amber-700">
          <Link href="/admin/promo" className="text-blue-700 hover:underline">
            К списку промокодов
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <nav className="text-sm" aria-label="Хлебные крошки">
        <Link href="/admin/promo" className="text-blue-700 hover:underline">
          Промокоды
        </Link>
        <span className="mx-1 text-gray-400">/</span>
        <span className="text-gray-600">{promo.code}</span>
      </nav>
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">
          Промокод <code>{promo.code}</code>
        </h1>
        <span className="text-sm text-gray-500">Использован: {promo.usedCount} раз</span>
      </div>
      <div className="mt-6">
        <PromoForm promo={promo} targets={targets} />
      </div>
    </div>
  );
}
