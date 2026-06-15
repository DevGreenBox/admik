'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ActionResult } from '@/lib/server/action';

import {
  deactivatePromoCodeAction,
  deletePromoCodeAction,
} from '../../orders/_components/order-actions';
import { errorMessage } from '../../orders/_components/action-result';

type Fail = Extract<ActionResult<unknown>, { ok: false }>;

/**
 * Действия над строкой промокода в списке: деактивация (мягкое «удаление»,
 * is_active=false — история заказов не рушится) и полное удаление (DELETE,
 * snapshot orders.promo_code сохраняется). Оба — orders.write на сервере;
 * с подтверждением. Ошибки показываются inline под строкой.
 */
export function PromoRowActions({
  id,
  code,
  isActive,
}: {
  id: string;
  code: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<Fail | null>(null);
  const [pending, setPending] = useState(false);

  async function run(
    fn: () => Promise<ActionResult<unknown>>,
    confirmText: string,
  ) {
    if (!window.confirm(confirmText)) return;
    setPending(true);
    setError(null);
    const result = await fn();
    setPending(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(result);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {isActive ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => deactivatePromoCodeAction({ id }),
                `Деактивировать промокод «${code}»?`,
              )
            }
            className="text-xs text-amber-700 hover:underline disabled:opacity-50"
          >
            Деактивировать
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () => deletePromoCodeAction({ id }),
              `Удалить промокод «${code}» безвозвратно? История заказов сохранится.`,
            )
          }
          className="text-xs text-red-700 hover:underline disabled:opacity-50"
        >
          Удалить
        </button>
      </div>
      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {errorMessage(error)}
        </span>
      ) : null}
    </div>
  );
}
