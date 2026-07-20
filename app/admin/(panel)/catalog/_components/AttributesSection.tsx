'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Attribute, AttributeValue, ProductDetail } from '@/lib/catalog/types';

import { setProductAttributesAction } from './form-actions';
import { buildProductAttributeItems } from './attributes-payload';
import { errorMessage } from './action-result';
import type { ActionResult } from '@/lib/server/action';

/**
 * Секция «Характеристики» (EAV, docs/05 §5.3). Форма строится ИЗ метаданных
 * attributes (тип/единица/обязательность) — без хардкода под магазин.
 *
 * Сохранение — setProductAttributes, операция ПОЛНОЙ ЗАМЕНЫ: она безусловно
 * сносит привязки уровня товара и привязки перечисленных вариантов. Поэтому
 * форма обязана слать ПОЛНЫЙ набор — уровень товара (из полей формы) ПЛЮС
 * вариантный уровень (пас-сквозь текущего состояния: цвет варианта задаётся в
 * секции «Варианты» и здесь не редактируется, но обязан доехать до сервера).
 * Сборка — чистый buildProductAttributeItems, покрытый юнит-тестом.
 */
type Fail = Extract<ActionResult<unknown>, { ok: false }>;

export function AttributesSection({
  product,
  attributes,
  attributeValues = {},
}: {
  product: ProductDetail;
  attributes: Attribute[];
  /** Значения словаря по attribute_id — для выпадающего списка select-атрибутов. */
  attributeValues?: Record<string, AttributeValue[]>;
}) {
  const router = useRouter();
  const [error, setError] = useState<Fail | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  // Форма редактирует ТОЛЬКО уровень товара (variantId IS NULL): у варианта
  // тот же атрибут может иметь своё значение, и смешивать их в одном поле
  // нельзя. Вариантные привязки не отбрасываются — они переносятся в payload
  // при сохранении (см. buildProductAttributeItems).
  const initial: Record<string, string> = {};
  for (const pa of product.attributes) {
    if (pa.variantId !== null) continue;
    initial[pa.attributeId] = pa.valueText ?? pa.valueId ?? '';
  }
  const [values, setValues] = useState<Record<string, string>>(initial);

  function setValue(attributeId: string, value: string) {
    setValues((prev) => ({ ...prev, [attributeId]: value }));
  }

  async function save() {
    setPending(true);
    setError(null);
    setSuccess(false);

    const items = buildProductAttributeItems({
      attributes,
      values,
      existing: product.attributes,
    });

    const result = await setProductAttributesAction({ productId: product.id, items });
    setPending(false);
    if (result.ok) {
      setSuccess(true);
      router.refresh();
    } else {
      setError(result);
    }
  }

  if (attributes.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Справочник характеристик пуст. Заведите атрибуты в разделе характеристик.
      </p>
    );
  }

  return (
    <div>
      {error ? (
        <div role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {errorMessage(error)}
        </div>
      ) : null}
      {success ? (
        <div role="status" className="mb-3 rounded border border-green-200 bg-green-50 p-2 text-sm text-green-700">
          Характеристики сохранены.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {attributes.map((attr) => {
          const id = `attr-${attr.id}`;
          return (
            <div key={attr.id}>
              <label htmlFor={id} className="block text-sm font-medium text-gray-700">
                {attr.name}
                {attr.isRequired ? <span className="text-red-600"> *</span> : null}
                {attr.unit ? <span className="text-gray-400">, {attr.unit}</span> : null}
              </label>
              {attr.type === 'boolean' ? (
                <select
                  id={id}
                  value={values[attr.id] ?? ''}
                  onChange={(e) => setValue(attr.id, e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  <option value="true">Да</option>
                  <option value="false">Нет</option>
                </select>
              ) : attr.type === 'select' ? (
                // Выбор значения из словаря по названию (раньше — ввод ID вручную).
                <select
                  id={id}
                  value={values[attr.id] ?? ''}
                  onChange={(e) => setValue(attr.id, e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">— не выбрано —</option>
                  {(attributeValues[attr.id] ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.value}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  type={attr.type === 'number' ? 'number' : 'text'}
                  value={values[attr.id] ?? ''}
                  onChange={(e) => setValue(attr.id, e.target.value)}
                  placeholder=""
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="mt-4 rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? 'Сохранение…' : 'Сохранить характеристики'}
      </button>
    </div>
  );
}
