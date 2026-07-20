'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import type {
  Attribute,
  AttributeValue,
  ProductDetail,
  ProductVariant,
} from '@/lib/catalog/types';
import { isColorAttribute } from '@/lib/catalog/color';
import {
  parseMatrixList,
  planVariantMatrix,
  type ExistingMatrixVariant,
} from '@/lib/catalog/variant-matrix';

import {
  createVariantAction,
  updateVariantAction,
  deleteVariantAction,
  reorderVariantAction,
  applyVariantMatrixAction,
} from './form-actions';
import {
  buildVariantCreateInput,
  buildVariantUpdateInput,
  type VariantFormValues,
} from './variant-payload';
import { errorMessage } from './action-result';
import type { ActionResult } from '@/lib/server/action';

/**
 * Секция «Варианты» (docs/05 §5.3). Таблица вариантов товара + форма добавления +
 * инлайн-редактирование (C2) и переупорядочивание (C12). Мутации — Server Actions
 * createVariant/updateVariant/deleteVariant/reorderVariant (catalog.write).
 *
 * Сборка payload форм — чистый модуль variant-payload (нормализация денег/габаритов
 * общая для добавления и редактирования, покрыта юнит-тестами).
 *
 * МАТРИЦА «ЦВЕТ × РАЗМЕР» (спринт B). Идентичность варианта распределена:
 * РАЗМЕР — это product_variants.name, ЦВЕТ — вариантная привязка EAV
 * (product_attributes.variant_id → attribute_values). Поэтому поле варианта
 * называется «Размер», а не «Размер / название»: писать в name «Белый / 42»
 * НЕЛЬЗЯ — фасет размеров каталога сравнивает метки точной строкой и
 * рассинхронизировался бы со списком товаров.
 *
 * Раскладка матрицы (что создать / включить / погасить) считается чистой
 * функцией planVariantMatrix — тем же кодом, что и на сервере, поэтому предпросмотр
 * «будет создано N» не расходится с фактическим результатом. Применение — ОДИН
 * вызов applyVariantMatrix (одна транзакция, один аудит), а не N*M createVariant.
 */
type Fail = Extract<ActionResult<unknown>, { ok: false }>;

const inputCls = 'w-full rounded border border-gray-300 px-2 py-1 text-sm';

/** Пустые строковые поля формы варианта. */
const EMPTY_FORM: VariantFormValues = {
  sku: '',
  name: '',
  priceOverride: '',
  priceDelta: '0',
  compareAtPrice: '',
  weight: '',
  length: '',
  width: '',
  height: '',
};

/** Предзаполнение формы редактирования значениями существующего варианта. */
function formFromVariant(v: ProductVariant): VariantFormValues {
  return {
    sku: v.sku,
    name: v.name,
    priceOverride: v.priceOverride ?? '',
    priceDelta: v.priceDelta ?? '0',
    compareAtPrice: v.compareAtPrice ?? '',
    weight: v.weightG != null ? String(v.weightG) : '',
    length: v.lengthCm != null ? String(v.lengthCm) : '',
    width: v.widthCm != null ? String(v.widthCm) : '',
    height: v.heightCm != null ? String(v.heightCm) : '',
  };
}

export function VariantsSection({
  product,
  attributes = [],
  attributeValues = {},
}: {
  product: ProductDetail;
  /** Справочник характеристик — чтобы найти «Цвет» для оси матрицы. */
  attributes?: Attribute[];
  /** Значения словарей по attribute_id — источник цветов матрицы. */
  attributeValues?: Record<string, AttributeValue[]>;
}) {
  const router = useRouter();
  const [error, setError] = useState<Fail | null>(null);
  /** Не-ошибочное предупреждение (напр. пропущенные ячейки матрицы). */
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Форма добавления.
  const [form, setForm] = useState<VariantFormValues>(EMPTY_FORM);
  const setField = (k: keyof VariantFormValues, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  // --- Матрица «цвет × размер» -------------------------------------------
  // Справочник «Цвет» ищем по имени/коду (lib/catalog/color), а НЕ по флагу
  // attributes.is_variant: в реальных данных он почти всегда не проставлен.
  const colorAttribute = useMemo(
    () => attributes.find((a) => isColorAttribute(a) && a.type === 'select') ?? null,
    [attributes],
  );
  const colorValues: AttributeValue[] = useMemo(
    () => (colorAttribute ? (attributeValues[colorAttribute.id] ?? []) : []),
    [colorAttribute, attributeValues],
  );
  const colorById = useMemo(() => {
    const map = new Map<string, AttributeValue>();
    for (const v of colorValues) map.set(v.id, v);
    return map;
  }, [colorValues]);

  // Текущий цвет каждого варианта — из вариантных привязок EAV.
  const variantColorId = useMemo(() => {
    const map = new Map<string, string>();
    if (!colorAttribute) return map;
    for (const pa of product.attributes) {
      if (pa.variantId && pa.attributeId === colorAttribute.id && pa.valueId) {
        map.set(pa.variantId, pa.valueId);
      }
    }
    return map;
  }, [product.attributes, colorAttribute]);

  const [pickedColors, setPickedColors] = useState<string[]>([]);
  const [sizesText, setSizesText] = useState('');
  const [deactivateMissing, setDeactivateMissing] = useState(false);

  function toggleColor(id: string) {
    setPickedColors((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // Предпросмотр считается ТЕМ ЖЕ planVariantMatrix, что и сервер, поэтому
  // «будет создано N» гарантированно совпадает с результатом применения.
  const existingForPlan: ExistingMatrixVariant[] = product.variants.map((v) => ({
    id: v.id,
    name: v.name,
    colorValueId: variantColorId.get(v.id) ?? null,
    isActive: v.isActive,
  }));
  const plan = useMemo(
    () =>
      planVariantMatrix({
        colors: pickedColors.map((id) => ({
          valueId: id,
          value: colorById.get(id)?.value ?? '',
        })),
        sizes: parseMatrixList(sizesText),
        existing: existingForPlan,
        deactivateMissing,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickedColors, sizesText, deactivateMissing, colorById, product.variants, variantColorId],
  );

  /** Свотч + подпись цвета варианта; «—» если цвет не заведён. */
  function colorLabel(v: ProductVariant) {
    const value = colorById.get(variantColorId.get(v.id) ?? '');
    if (!value) return <span className="text-gray-300">—</span>;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-3.5 rounded-full border border-gray-300"
          style={value.colorHex ? { backgroundColor: value.colorHex } : undefined}
        />
        <span className="text-xs">{value.value}</span>
      </span>
    );
  }

  async function applyMatrix() {
    setPending(true);
    setError(null);
    setNotice(null);
    // Отправляем ТОЛЬКО id значений справочника: подпись цвета (она уходит в
    // артикул и в аудит) действие берёт из attribute_values само — клиентской
    // подписи оно не доверяет.
    const result = await applyVariantMatrixAction({
      productId: product.id,
      colorAttributeId: colorAttribute?.id,
      colors: pickedColors,
      sizes: parseMatrixList(sizesText),
      deactivateMissing,
    });
    setPending(false);
    if (result.ok) {
      setSizesText('');
      setPickedColors([]);
      setDeactivateMissing(false);
      // Ячейка без свободного артикула пропускается (транзакция из-за неё не
      // откатывается) — но редактор должен об этом узнать, а не гадать.
      if (result.data.skipped > 0) {
        setNotice(
          `Создано вариантов: ${result.data.created}. Пропущено из-за занятого артикула: ${result.data.skipped} — задайте им артикул вручную.`,
        );
      }
      router.refresh();
    } else {
      setError(result);
    }
  }

  // Инлайн-редактирование: id редактируемой строки + её черновик.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<VariantFormValues>(EMPTY_FORM);
  const setEditField = (k: keyof VariantFormValues, v: string) =>
    setEditForm((f) => ({ ...f, [k]: v }));

  async function addVariant() {
    setPending(true);
    setError(null);
    // Нормализация (RU-запятая/пробел разрядов → каноничные деньги, пусто → null)
    // и сборка payload — в чистом маппере buildVariantCreateInput.
    const result = await createVariantAction(buildVariantCreateInput(product.id, form));
    setPending(false);
    if (result.ok) {
      setForm(EMPTY_FORM);
      router.refresh();
    } else {
      setError(result);
    }
  }

  function startEdit(v: ProductVariant) {
    setError(null);
    setEditingId(v.id);
    setEditForm(formFromVariant(v));
  }

  async function saveEdit() {
    if (!editingId) return;
    setPending(true);
    setError(null);
    const result = await updateVariantAction(buildVariantUpdateInput(editingId, editForm));
    setPending(false);
    if (result.ok) {
      setEditingId(null);
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
    if (!window.confirm('Удалить вариант? Действие необратимо, остатки варианта будут потеряны.')) {
      return;
    }
    setError(null);
    const result = await deleteVariantAction({ id });
    if (result.ok) router.refresh();
    else setError(result);
  }

  /** Переставить вариант на позицию index+dir (вверх/вниз) и сохранить порядок. */
  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= product.variants.length) return;
    const order = product.variants.map((v) => v.id);
    [order[index], order[target]] = [order[target]!, order[index]!];
    setError(null);
    const result = await reorderVariantAction({ productId: product.id, order });
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

      {notice ? (
        <div
          role="status"
          className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800"
        >
          {notice}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Размер</th>
              <th scope="col" className="px-3 py-2 font-medium">Цвет</th>
              <th scope="col" className="px-3 py-2 font-medium">Артикул</th>
              <th scope="col" className="px-3 py-2 font-medium">Своя цена</th>
              <th scope="col" className="px-3 py-2 font-medium">Цена «было»</th>
              <th scope="col" className="px-3 py-2 font-medium">Доплата</th>
              <th scope="col" className="px-3 py-2 font-medium">Вес/габариты</th>
              <th scope="col" className="px-3 py-2 font-medium">Активен</th>
              <th scope="col" className="px-3 py-2 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {product.variants.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-gray-400">
                  Вариантов пока нет.
                </td>
              </tr>
            ) : (
              product.variants.map((v, index) =>
                editingId === v.id ? (
                  <tr key={v.id} className="bg-amber-50/40">
                    <td className="px-3 py-2">
                      <input aria-label="Размер" value={editForm.name}
                        onChange={(e) => setEditField('name', e.target.value)} className={inputCls} />
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {/* Цвет — вариантный EAV, отдельная сущность: правится матрицей,
                          а не инлайн-формой варианта (иначе легко получить два цвета
                          у одного варианта). */}
                      {colorLabel(v)}
                    </td>
                    <td className="px-3 py-2">
                      <input aria-label="Артикул" value={editForm.sku}
                        onChange={(e) => setEditField('sku', e.target.value)} className={inputCls} />
                    </td>
                    <td className="px-3 py-2">
                      <input aria-label="Своя цена" inputMode="decimal" value={editForm.priceOverride}
                        onChange={(e) => setEditField('priceOverride', e.target.value)} className={inputCls} />
                    </td>
                    <td className="px-3 py-2">
                      <input aria-label="Цена «было»" inputMode="decimal" value={editForm.compareAtPrice}
                        onChange={(e) => setEditField('compareAtPrice', e.target.value)} className={inputCls} />
                    </td>
                    <td className="px-3 py-2">
                      <input aria-label="Доплата" inputMode="decimal" value={editForm.priceDelta}
                        onChange={(e) => setEditField('priceDelta', e.target.value)} className={inputCls} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="grid grid-cols-4 gap-1">
                        <input aria-label="Вес (г)" inputMode="numeric" value={editForm.weight}
                          onChange={(e) => setEditField('weight', e.target.value)} placeholder="вес" className={inputCls} />
                        <input aria-label="Длина (см)" inputMode="numeric" value={editForm.length}
                          onChange={(e) => setEditField('length', e.target.value)} placeholder="дл" className={inputCls} />
                        <input aria-label="Ширина (см)" inputMode="numeric" value={editForm.width}
                          onChange={(e) => setEditField('width', e.target.value)} placeholder="ш" className={inputCls} />
                        <input aria-label="Высота (см)" inputMode="numeric" value={editForm.height}
                          onChange={(e) => setEditField('height', e.target.value)} placeholder="в" className={inputCls} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{v.isActive ? 'да' : 'нет'}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void saveEdit()} disabled={pending || !editForm.name.trim()}
                          className="text-xs font-medium text-blue-700 hover:underline disabled:opacity-50">
                          сохранить
                        </button>
                        <button type="button" onClick={() => setEditingId(null)}
                          className="text-xs text-gray-500 hover:underline">
                          отмена
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={v.id}>
                    <td className="px-3 py-2 text-gray-700">{v.name || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{colorLabel(v)}</td>
                    <td className="px-3 py-2"><code className="text-xs">{v.sku}</code></td>
                    <td className="px-3 py-2 text-gray-700">{v.priceOverride ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{v.compareAtPrice ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{v.priceDelta}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {v.weightG !== null || v.lengthCm !== null || v.widthCm !== null || v.heightCm !== null
                        ? `${v.weightG ?? '—'} г / ${v.lengthCm ?? '—'}×${v.widthCm ?? '—'}×${v.heightCm ?? '—'} см`
                        : '—'}
                    </td>
                    <td className="px-3 py-2">{v.isActive ? 'да' : 'нет'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => move(index, -1)} disabled={index === 0}
                          title="Выше" aria-label="Поднять вариант выше"
                          className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30">
                          ↑
                        </button>
                        <button type="button" onClick={() => move(index, 1)} disabled={index === product.variants.length - 1}
                          title="Ниже" aria-label="Опустить вариант ниже"
                          className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30">
                          ↓
                        </button>
                        <button type="button" onClick={() => startEdit(v)}
                          className="text-xs text-gray-700 hover:underline">
                          редактировать
                        </button>
                        <button type="button" onClick={() => toggleActive(v.id, v.isActive)}
                          className="text-xs text-blue-700 hover:underline">
                          {v.isActive ? 'отключить' : 'включить'}
                        </button>
                        <button type="button" onClick={() => removeVariant(v.id)}
                          className="text-xs text-red-600 hover:underline">
                          удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>


      {/* --- Матрица «цвет × размер» ------------------------------------- */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">Матрица «цвет × размер»</h3>
        {!colorAttribute ? (
          <p className="mt-2 text-xs text-gray-500">
            Справочник цвета не найден. Чтобы вести цвет как вариант, заведите в{' '}
            <Link href="/admin/catalog/attributes" className="text-blue-700 hover:underline">
              характеристиках
            </Link>{' '}
            характеристику с названием «Цвет» типа «Список значений (select)» и
            добавьте в её словарь цвета с HEX. Пока справочника нет, матрица создаёт
            только размеры.
          </p>
        ) : colorValues.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">
            В словаре «{colorAttribute.name}» пока нет значений —{' '}
            <Link
              href={`/admin/catalog/attributes/${colorAttribute.id}`}
              className="text-blue-700 hover:underline"
            >
              добавьте цвета
            </Link>
            . Без них матрица создаст только размеры.
          </p>
        ) : (
          <fieldset className="mt-3">
            <legend className="text-xs font-medium text-gray-600">Цвета</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
              {colorValues.map((cv) => (
                <label key={cv.id} className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={pickedColors.includes(cv.id)}
                    onChange={() => toggleColor(cv.id)}
                    className="rounded border-gray-300"
                  />
                  <span
                    aria-hidden="true"
                    className="inline-block h-4 w-4 rounded-full border border-gray-300"
                    style={cv.colorHex ? { backgroundColor: cv.colorHex } : undefined}
                  />
                  {cv.value}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mt-3">
          <label htmlFor="matrix-sizes" className="block text-xs font-medium text-gray-600">
            Размеры (через запятую или с новой строки)
          </label>
          <textarea
            id="matrix-sizes"
            rows={2}
            value={sizesText}
            onChange={(e) => setSizesText(e.target.value)}
            placeholder="42, 44, 46, 48"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Размер попадёт в название варианта. Цвет в название НЕ добавляется — он
            хранится отдельно, иначе сломается фильтр по размеру в каталоге.
          </p>
        </div>

        <label className="mt-3 inline-flex items-start gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={deactivateMissing}
            onChange={(e) => setDeactivateMissing(e.target.checked)}
            className="mt-0.5 rounded border-gray-300"
          />
          <span>
            Отключить варианты вне матрицы. Варианты не удаляются никогда: их
            хранят оформленные заказы — только снимаются с продажи.
          </span>
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void applyMatrix()}
            disabled={pending || plan.create.length + plan.activate.length + plan.deactivate.length === 0}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {pending ? 'Применение…' : 'Применить матрицу'}
          </button>
          <p role="status" className="text-xs text-gray-600">
            {parseMatrixList(sizesText).length === 0
              ? 'Укажите размеры — появится предпросмотр.'
              : `Будет создано: ${plan.create.length}` +
                `; уже есть: ${plan.keep.length}` +
                `; включить обратно: ${plan.activate.length}` +
                `; отключить: ${plan.deactivate.length}.`}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h3 className="text-sm font-semibold text-gray-800">Добавить вариант</h3>
        <p className="mt-1 text-xs text-gray-500">
          Вариант — это одна позиция товара. В поле «Размер» пишется ТОЛЬКО размер
          («48», «M», «42 / XS»); цвет задаётся матрицей выше и хранится отдельно.
          Остаток варианта задаётся в таблице ниже.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="v-name" className="block text-xs font-medium text-gray-600">Размер*</label>
            <input id="v-name" value={form.name} onChange={(e) => setField('name', e.target.value)}
              placeholder="напр. 48, M, 42 / XS"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="v-override" className="block text-xs font-medium text-gray-600">Своя цена</label>
            <input id="v-override" inputMode="decimal" value={form.priceOverride} onChange={(e) => setField('priceOverride', e.target.value)}
              placeholder="пусто — как у товара"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="v-compare" className="block text-xs font-medium text-gray-600">Цена «было»</label>
            <input id="v-compare" inputMode="decimal" value={form.compareAtPrice} onChange={(e) => setField('compareAtPrice', e.target.value)}
              placeholder="пусто — как у товара"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="v-delta" className="block text-xs font-medium text-gray-600">Доплата к цене</label>
            <input id="v-delta" inputMode="decimal" value={form.priceDelta} onChange={(e) => setField('priceDelta', e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="v-sku" className="block text-xs font-medium text-gray-600">Артикул</label>
            <input id="v-sku" value={form.sku} onChange={(e) => setField('sku', e.target.value)}
              placeholder="можно не заполнять"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Вес/габариты варианта (пусто — берётся от товара → дефолт магазина):
        </p>
        <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="v-weight" className="block text-xs font-medium text-gray-600">Вес (г)</label>
            <input id="v-weight" inputMode="numeric" value={form.weight} onChange={(e) => setField('weight', e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="v-length" className="block text-xs font-medium text-gray-600">Длина (см)</label>
            <input id="v-length" inputMode="numeric" value={form.length} onChange={(e) => setField('length', e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="v-width" className="block text-xs font-medium text-gray-600">Ширина (см)</label>
            <input id="v-width" inputMode="numeric" value={form.width} onChange={(e) => setField('width', e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="v-height" className="block text-xs font-medium text-gray-600">Высота (см)</label>
            <input id="v-height" inputMode="numeric" value={form.height} onChange={(e) => setField('height', e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
        </div>
        <button
          type="button"
          onClick={addVariant}
          disabled={pending || !form.name.trim()}
          className="mt-3 rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pending ? 'Добавление…' : 'Добавить вариант'}
        </button>
      </div>
    </div>
  );
}
