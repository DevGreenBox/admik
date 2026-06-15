'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type {
  Brand,
  CategoryTreeNode,
  ProductDetail,
} from '@/lib/catalog/types';
import { PRODUCT_STATUSES, type ProductStatus } from '@/lib/catalog/types';
import type { ActionResult } from '@/lib/server/action';

import { createProductAction, updateProductAction } from './form-actions';
import { errorMessage, fieldError } from './action-result';
import { VariantsSection } from './VariantsSection';
import { AttributesSection } from './AttributesSection';
import { MediaSection } from './MediaSection';
import { InventorySection } from './InventorySection';
import type { Attribute } from '@/lib/catalog/types';

/**
 * Форма товара (docs/05 §5.3, П4.2). Секции-вкладки:
 * Основное / Варианты / Характеристики / Медиа / SEO.
 *
 * «Основное» доступно и при создании, и при редактировании; прочие секции —
 * только для существующего товара (нужен id). Сабмит — Server Action
 * createProduct/updateProduct; ошибки валидации берутся из fieldErrors.
 */

type Section = 'main' | 'variants' | 'attributes' | 'media' | 'seo';

const STATUS_LABEL: Record<ProductStatus, string> = {
  draft: 'Черновик',
  active: 'Активен',
  archived: 'В архиве',
};

function flattenCategories(
  nodes: CategoryTreeNode[],
  depth = 0,
): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const node of nodes) {
    out.push({ id: node.id, label: `${'— '.repeat(depth)}${node.name}` });
    out.push(...flattenCategories(node.children, depth + 1));
  }
  return out;
}

type FailResult = Extract<ActionResult<unknown>, { ok: false }>;

export function ProductForm({
  product,
  brands,
  categoryTree,
  attributes,
}: {
  /** null → режим создания. */
  product: ProductDetail | null;
  brands: Brand[];
  categoryTree: CategoryTreeNode[];
  attributes: Attribute[];
}) {
  const router = useRouter();
  const isEdit = product !== null;

  const [section, setSection] = useState<Section>('main');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FailResult | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Поля «Основное».
  const [sku, setSku] = useState(product?.sku ?? '');
  const [slug, setSlug] = useState(product?.slug ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? 'draft');
  const [basePrice, setBasePrice] = useState(product?.basePrice ?? '0');
  const [compareAtPrice, setCompareAtPrice] = useState(product?.compareAtPrice ?? '');
  const [brandId, setBrandId] = useState(product?.brandId ?? '');
  const [isFeatured, setIsFeatured] = useState(product?.isFeatured ?? false);
  // is_new — троичная логика: 'auto' (null) | 'yes' (true) | 'no' (false).
  const [isNewMode, setIsNewMode] = useState<'auto' | 'yes' | 'no'>(
    product?.isNew === null || product?.isNew === undefined
      ? 'auto'
      : product.isNew
        ? 'yes'
        : 'no',
  );
  const [seoTitle, setSeoTitle] = useState(product?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(product?.seoDescription ?? '');

  const initialCategoryIds = product?.categories.map((c) => c.categoryId) ?? [];
  const [categoryIds, setCategoryIds] = useState<string[]>(initialCategoryIds);
  const [primaryCategoryId, setPrimaryCategoryId] = useState<string>(
    product?.categories.find((c) => c.isPrimary)?.categoryId ?? '',
  );

  const categories = flattenCategories(categoryTree);

  function toggleCategory(id: string) {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSubmit() {
    setPending(true);
    setError(null);
    setSuccess(null);

    const isNew = isNewMode === 'auto' ? null : isNewMode === 'yes';
    const payload = {
      sku: sku.trim(),
      slug: slug.trim() || undefined,
      name: name.trim(),
      description,
      status,
      basePrice: basePrice.trim() || '0',
      compareAtPrice: compareAtPrice.trim() ? compareAtPrice.trim() : null,
      isFeatured,
      isNew,
      brandId: brandId || null,
      categoryIds,
      primaryCategoryId: primaryCategoryId || null,
      seoTitle: seoTitle.trim() || undefined,
      seoDescription: seoDescription.trim() || undefined,
    };

    try {
      const result = isEdit
        ? await updateProductAction({ id: product!.id, ...payload })
        : await createProductAction(payload);

      if (result.ok) {
        if (isEdit) {
          setSuccess('Изменения сохранены.');
          router.refresh();
        } else {
          router.push(`/admin/catalog/products/${result.data.id}`);
        }
      } else {
        setError(result);
      }
    } catch {
      setError({ ok: false, error: 'internal' });
    } finally {
      setPending(false);
    }
  }

  const tabs: Array<{ key: Section; label: string; editOnly?: boolean }> = [
    { key: 'main', label: 'Основное' },
    { key: 'variants', label: 'Варианты', editOnly: true },
    { key: 'attributes', label: 'Характеристики', editOnly: true },
    { key: 'media', label: 'Медиа', editOnly: true },
    { key: 'seo', label: 'SEO' },
  ];

  function fieldErr(f: string) {
    return fieldError(error, f);
  }

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

      <div role="tablist" aria-label="Секции товара" className="flex flex-wrap gap-1 border-b border-gray-200">
        {tabs
          .filter((t) => isEdit || !t.editOnly)
          .map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={section === t.key}
              onClick={() => setSection(t.key)}
              className={`px-4 py-2 text-sm font-medium ${
                section === t.key
                  ? 'border-b-2 border-gray-900 text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      <div className="mt-6">
        {section === 'main' ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <label htmlFor="p-name" className="block text-sm font-medium text-gray-700">
                Название*
              </label>
              <input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                required
              />
              {fieldErr('name') ? <p className="mt-1 text-xs text-red-600">{fieldErr('name')}</p> : null}
            </div>

            <div>
              <label htmlFor="p-sku" className="block text-sm font-medium text-gray-700">
                Артикул (SKU)*
              </label>
              <input
                id="p-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                required
              />
              {fieldErr('sku') ? <p className="mt-1 text-xs text-red-600">{fieldErr('sku')}</p> : null}
            </div>

            <div>
              <label htmlFor="p-slug" className="block text-sm font-medium text-gray-700">
                ЧПУ (slug)
              </label>
              <input
                id="p-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="оставьте пустым — сгенерируется из названия"
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
              {fieldErr('slug') ? <p className="mt-1 text-xs text-red-600">{fieldErr('slug')}</p> : null}
            </div>

            <div>
              <label htmlFor="p-status" className="block text-sm font-medium text-gray-700">
                Статус
              </label>
              <select
                id="p-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as ProductStatus)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                {PRODUCT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="p-price" className="block text-sm font-medium text-gray-700">
                Базовая цена*
              </label>
              <input
                id="p-price"
                inputMode="decimal"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
              {fieldErr('basePrice') ? <p className="mt-1 text-xs text-red-600">{fieldErr('basePrice')}</p> : null}
            </div>

            <div>
              <label htmlFor="p-compare" className="block text-sm font-medium text-gray-700">
                Цена до скидки («было»)
              </label>
              <input
                id="p-compare"
                inputMode="decimal"
                value={compareAtPrice}
                onChange={(e) => setCompareAtPrice(e.target.value)}
                placeholder="оставьте пустым — без скидки"
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
              {fieldErr('compareAtPrice') ? (
                <p className="mt-1 text-xs text-red-600">{fieldErr('compareAtPrice')}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="p-brand" className="block text-sm font-medium text-gray-700">
                Бренд
              </label>
              <select
                id="p-brand"
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">— без бренда —</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-gray-700">Флаги</legend>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={(e) => setIsFeatured(e.target.checked)}
                />
                Хит / Рекомендуемый (is_featured)
              </label>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <label htmlFor="p-isnew">Новинка (is_new):</label>
                <select
                  id="p-isnew"
                  value={isNewMode}
                  onChange={(e) => setIsNewMode(e.target.value as 'auto' | 'yes' | 'no')}
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="auto">Авто (по дате)</option>
                  <option value="yes">Да</option>
                  <option value="no">Нет</option>
                </select>
              </div>
            </fieldset>

            <div className="lg:col-span-2">
              <label htmlFor="p-desc" className="block text-sm font-medium text-gray-700">
                Описание
              </label>
              <textarea
                id="p-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <fieldset className="lg:col-span-2">
              <legend className="text-sm font-medium text-gray-700">Категории</legend>
              {categories.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">
                  Категорий пока нет. Создайте их в разделе «Категории».
                </p>
              ) : (
                <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {categories.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={categoryIds.includes(c.id)}
                        onChange={() => toggleCategory(c.id)}
                      />
                      <span>{c.label}</span>
                      {categoryIds.includes(c.id) ? (
                        <label className="ml-auto flex items-center gap-1 text-xs text-gray-500">
                          <input
                            type="radio"
                            name="primaryCategory"
                            checked={primaryCategoryId === c.id}
                            onChange={() => setPrimaryCategoryId(c.id)}
                          />
                          основная
                        </label>
                      ) : null}
                    </label>
                  ))}
                </div>
              )}
              {fieldErr('primaryCategoryId') ? (
                <p className="mt-1 text-xs text-red-600">{fieldErr('primaryCategoryId')}</p>
              ) : null}
            </fieldset>
          </div>
        ) : null}

        {section === 'seo' ? (
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label htmlFor="p-seo-title" className="block text-sm font-medium text-gray-700">
                SEO-заголовок
              </label>
              <input
                id="p-seo-title"
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="p-seo-desc" className="block text-sm font-medium text-gray-700">
                SEO-описание
              </label>
              <textarea
                id="p-seo-desc"
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <p className="text-sm text-gray-500">
              Предпросмотр URL: <code>/{slug || 'slug-товара'}</code> (генерация sitemap — Этап 5).
            </p>
          </div>
        ) : null}

        {section === 'variants' && isEdit ? (
          <VariantsSection product={product!} />
        ) : null}
        {section === 'attributes' && isEdit ? (
          <AttributesSection product={product!} attributes={attributes} />
        ) : null}
        {section === 'media' && isEdit ? <MediaSection product={product!} /> : null}
      </div>

      {section === 'main' || section === 'seo' ? (
        <div className="mt-6 flex items-center gap-3 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={onSubmit}
            disabled={pending}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {pending ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Создать товар'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/admin/catalog')}
            className="text-sm text-gray-600 hover:underline"
          >
            Отмена
          </button>
        </div>
      ) : null}

      {isEdit && section === 'variants' ? null : null}
      {isEdit ? <InventorySectionPlaceholder section={section} product={product!} /> : null}
    </div>
  );
}

/** Остатки показываем во вкладке «Варианты» рядом с вариантами. */
function InventorySectionPlaceholder({
  section,
  product,
}: {
  section: Section;
  product: ProductDetail;
}) {
  if (section !== 'variants') {
    return null;
  }
  return (
    <div className="mt-8 border-t border-gray-200 pt-6">
      <InventorySection product={product} />
    </div>
  );
}
