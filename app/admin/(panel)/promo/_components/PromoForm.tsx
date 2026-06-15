'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PROMO_KINDS } from '@/lib/orders/types';
import type { PromoCode } from '@/lib/orders/types';
import { promoKindLabel } from '@/lib/admin/order-format';
import type { ActionResult } from '@/lib/server/action';

import {
  createPromoCodeAction,
  updatePromoCodeAction,
} from '../../orders/_components/order-actions';
import { errorMessage, fieldError } from '../../orders/_components/action-result';

type Fail = Extract<ActionResult<unknown>, { ok: false }>;

/**
 * Форма промокода (docs/07 §5, §3): создание/редактирование. Поля: код, тип
 * (percent/fixed/free_delivery/bogo), значение, условия (мин.сумма, потолок,
 * лимиты всего/на покупателя), срок (с/по), активность, bogo N/M, комментарий.
 * Мутации — createPromoCode/updatePromoCode (orders.write на сервере; здесь только
 * сбор значений и отображение ошибок, бизнес-валидация в Zod-схемах/actions).
 */

/** Дата для <input type="date"> (YYYY-MM-DD) из Date | null. */
function toDateInput(d: Date | null): string {
  if (!d) return '';
  const iso = d instanceof Date ? d.toISOString() : new Date(d).toISOString();
  return iso.slice(0, 10);
}

/** Число из строки поля или null/undefined для пустого. */
function numOrUndef(v: string): number | undefined {
  const t = v.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function PromoForm({ promo }: { promo: PromoCode | null }) {
  const router = useRouter();
  const isEdit = promo !== null;

  const [error, setError] = useState<Fail | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [code, setCode] = useState(promo?.code ?? '');
  const [kind, setKind] = useState(promo?.kind ?? 'percent');
  const [value, setValue] = useState(promo?.value ?? '0');
  const [minOrderTotal, setMinOrderTotal] = useState(promo?.minOrderTotal ?? '0');
  const [maxDiscount, setMaxDiscount] = useState(promo?.maxDiscount ?? '');
  const [usageLimit, setUsageLimit] = useState(
    promo?.usageLimit != null ? String(promo.usageLimit) : '',
  );
  const [perCustomerLimit, setPerCustomerLimit] = useState(
    promo?.perCustomerLimit != null ? String(promo.perCustomerLimit) : '',
  );
  const [startsAt, setStartsAt] = useState(toDateInput(promo?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toDateInput(promo?.endsAt ?? null));
  const [isActive, setIsActive] = useState(promo?.isActive ?? true);
  const [bogoBuyQty, setBogoBuyQty] = useState(
    promo?.bogoBuyQty != null ? String(promo.bogoBuyQty) : '',
  );
  const [bogoPayQty, setBogoPayQty] = useState(
    promo?.bogoPayQty != null ? String(promo.bogoPayQty) : '',
  );
  const [comment, setComment] = useState(promo?.comment ?? '');

  async function save() {
    setPending(true);
    setError(null);
    setSuccess(null);

    const payload = {
      code: code.trim(),
      kind,
      value: value.trim() || '0',
      minOrderTotal: minOrderTotal.trim() || '0',
      maxDiscount: maxDiscount.trim() || null,
      usageLimit: numOrUndef(usageLimit) ?? null,
      perCustomerLimit: numOrUndef(perCustomerLimit) ?? null,
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      isActive,
      bogoBuyQty: numOrUndef(bogoBuyQty) ?? null,
      bogoPayQty: numOrUndef(bogoPayQty) ?? null,
      comment,
    };

    const result = isEdit
      ? await updatePromoCodeAction({ id: promo!.id, ...payload })
      : await createPromoCodeAction(payload);

    setPending(false);
    if (result.ok) {
      if (isEdit) {
        setSuccess('Изменения сохранены.');
        router.refresh();
      } else {
        router.push('/admin/promo');
      }
    } else {
      setError(result);
    }
  }

  function fe(f: string) {
    return fieldError(error, f);
  }

  const showBogo = kind === 'bogo';
  const showPercentHint = kind === 'percent';

  return (
    <div>
      {error ? (
        <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMessage(error)}
        </div>
      ) : null}
      {success ? (
        <div role="status" className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {success}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="p-code" className="block text-sm font-medium text-gray-700">Код*</label>
          <input id="p-code" value={code} onChange={(e) => setCode(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" required />
          {fe('code') ? <p className="mt-1 text-xs text-red-600">{fe('code')}</p> : null}
        </div>

        <div>
          <label htmlFor="p-kind" className="block text-sm font-medium text-gray-700">Тип*</label>
          <select id="p-kind" value={kind} onChange={(e) => setKind(e.target.value as PromoCode['kind'])}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm">
            {PROMO_KINDS.map((k) => (
              <option key={k} value={k}>{promoKindLabel(k)}</option>
            ))}
          </select>
          {fe('kind') ? <p className="mt-1 text-xs text-red-600">{fe('kind')}</p> : null}
        </div>

        <div>
          <label htmlFor="p-value" className="block text-sm font-medium text-gray-700">
            Значение {showPercentHint ? '(проценты 0..100)' : kind === 'fixed' ? '(сумма)' : ''}
          </label>
          <input id="p-value" value={value} onChange={(e) => setValue(e.target.value)}
            inputMode="decimal" disabled={kind === 'free_delivery'}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100" />
          {fe('value') ? <p className="mt-1 text-xs text-red-600">{fe('value')}</p> : null}
        </div>

        <div>
          <label htmlFor="p-min" className="block text-sm font-medium text-gray-700">Мин. сумма заказа</label>
          <input id="p-min" value={minOrderTotal} onChange={(e) => setMinOrderTotal(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          {fe('minOrderTotal') ? <p className="mt-1 text-xs text-red-600">{fe('minOrderTotal')}</p> : null}
        </div>

        <div>
          <label htmlFor="p-maxdisc" className="block text-sm font-medium text-gray-700">Потолок скидки (для percent)</label>
          <input id="p-maxdisc" value={maxDiscount} onChange={(e) => setMaxDiscount(e.target.value)}
            inputMode="decimal" placeholder="без потолка"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          {fe('maxDiscount') ? <p className="mt-1 text-xs text-red-600">{fe('maxDiscount')}</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="p-usage" className="block text-sm font-medium text-gray-700">Лимит всего</label>
            <input id="p-usage" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)}
              inputMode="numeric" placeholder="∞"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="p-percust" className="block text-sm font-medium text-gray-700">На покупателя</label>
            <input id="p-percust" value={perCustomerLimit} onChange={(e) => setPerCustomerLimit(e.target.value)}
              inputMode="numeric" placeholder="∞"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          </div>
        </div>

        <div>
          <label htmlFor="p-starts" className="block text-sm font-medium text-gray-700">Начало</label>
          <input id="p-starts" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="p-ends" className="block text-sm font-medium text-gray-700">Окончание</label>
          <input id="p-ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          {fe('endsAt') ? <p className="mt-1 text-xs text-red-600">{fe('endsAt')}</p> : null}
        </div>

        {showBogo ? (
          <div className="grid grid-cols-2 gap-3 sm:col-span-2">
            <div>
              <label htmlFor="p-bogo-buy" className="block text-sm font-medium text-gray-700">Купи N</label>
              <input id="p-bogo-buy" value={bogoBuyQty} onChange={(e) => setBogoBuyQty(e.target.value)}
                inputMode="numeric"
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="p-bogo-pay" className="block text-sm font-medium text-gray-700">Плати за M</label>
              <input id="p-bogo-pay" value={bogoPayQty} onChange={(e) => setBogoPayQty(e.target.value)}
                inputMode="numeric"
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
              {fe('bogoPayQty') ? <p className="mt-1 text-xs text-red-600">{fe('bogoPayQty')}</p> : null}
            </div>
          </div>
        ) : null}

        <div className="sm:col-span-2">
          <label htmlFor="p-comment" className="block text-sm font-medium text-gray-700">Комментарий</label>
          <textarea id="p-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Активен
        </label>
      </div>

      <div className="mt-6 flex items-center gap-3 border-t border-gray-200 pt-4">
        <button type="button" onClick={save} disabled={pending}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {pending ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Создать промокод'}
        </button>
        <button type="button" onClick={() => router.push('/admin/promo')}
          className="text-sm text-gray-600 hover:underline">
          Отмена
        </button>
      </div>
    </div>
  );
}
