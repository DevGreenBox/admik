'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ProductDetail } from '@/lib/catalog/types';

import {
  createVariantAction,
  updateVariantAction,
  deleteVariantAction,
} from './form-actions';
import { errorMessage } from './action-result';
import type { ActionResult } from '@/lib/server/action';

/**
 * Секция «Варианты» (docs/05 §5.3). Таблица вариантов товара + форма добавления.
 * Мутации — Server Actions createVariant/updateVariant/deleteVariant (catalog.write).
 */
type Fail = Extract<ActionResult<unknown>, { ok: false }>;

export function VariantsSection({ product }: { product: ProductDetail }) {
  const router = useRouter();
  const [error, setError] = useState<Fail | null>(null);
  const [pending, setPending] = useState(false);

  const [newSku, setNewSku] = useState('');
  const [newName, setNewName] = useState('');
  const [newOverride, setNewOverride] = useState('');
  const [newDelta, setNewDelta] = useState('0');

  async function addVariant() {
    setPending(true);
    setError(null);
    const result = await createVariantAction({
      productId: product.id,
      sku: newSku.trim(),
      name: newName.trim(),
      priceOverride: newOverride.trim() ? newOverride.trim() : null,
      priceDelta: newDelta.trim() || '0',
    });
    setPending(false);
    if (result.ok) {
      setNewSku('');
      setNewName('');
      setNewOverride('');
      setNewDelta('0');
      router.refresh();
    } else {
      setError(result);
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    setError(null);
    const result = await updateVariantAction({ id, isActive: !isActive });
    if (result.ok) router.refresh();
    else setError(result);
  }

  async function removeVariant(id: string) {
    setError(null);
    const result = await deleteVariantAction({ id });
    if (result.ok) router.refresh();
    else setError(result);
  }

  return (
    <div>
      {error ? (
        <div role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {errorMessage(error)}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Артикул</th>
              <th scope="col" className="px-3 py-2 font-medium">Название</th>
              <th scope="col" className="px-3 py-2 font-medium">Цена (override)</th>
              <th scope="col" className="px-3 py-2 font-medium">Надбавка</th>
              <th scope="col" className="px-3 py-2 font-medium">Активен</th>
              <th scope="col" className="px-3 py-2 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {product.variants.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-gray-400">
                  Вариантов пока нет.
                </td>
              </tr>
            ) : (
              product.variants.map((v) => (
                <tr key={v.id}>
                  <td className="px-3 py-2"><code className="text-xs">{v.sku}</code></td>
                  <td className="px-3 py-2 text-gray-700">{v.name || '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{v.priceOverride ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{v.priceDelta}</td>
                  <td className="px-3 py-2">{v.isActive ? 'да' : 'нет'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => toggleActive(v.id, v.isActive)}
                        className="text-xs text-blue-700 hover:underline"
                      >
                        {v.isActive ? 'отключить' : 'включить'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeVariant(v.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h3 className="text-sm font-semibold text-gray-800">Добавить вариант</h3>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="v-sku" className="block text-xs font-medium text-gray-600">Артикул*</label>
            <input id="v-sku" value={newSku} onChange={(e) => setNewSku(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="v-name" className="block text-xs font-medium text-gray-600">Название</label>
            <input id="v-name" value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="напр. Красный / M"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="v-override" className="block text-xs font-medium text-gray-600">Цена (override)</label>
            <input id="v-override" inputMode="decimal" value={newOverride} onChange={(e) => setNewOverride(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="v-delta" className="block text-xs font-medium text-gray-600">Надбавка</label>
            <input id="v-delta" inputMode="decimal" value={newDelta} onChange={(e) => setNewDelta(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
        </div>
        <button
          type="button"
          onClick={addVariant}
          disabled={pending || !newSku.trim()}
          className="mt-3 rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pending ? 'Добавление…' : 'Добавить вариант'}
        </button>
      </div>
    </div>
  );
}
