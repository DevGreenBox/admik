'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import type { ProductDetail } from '@/lib/catalog/types';

import {
  uploadMediaAction,
  deleteMediaAction,
  reorderMediaAction,
} from './form-actions';
import { errorMessage } from './action-result';
import type { ActionResult } from '@/lib/server/action';

/**
 * Секция «Медиа» (docs/05 §5.5). Загрузка файла (превью), список с выбором
 * главного и удалением. Все проверки (magic-bytes/тип/размер) — на сервере
 * (attachMedia → validateUpload); клиент лишь отправляет файл.
 */
type Fail = Extract<ActionResult<unknown>, { ok: false }>;

export function MediaSection({ product }: { product: ProductDetail }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<Fail | null>(null);
  const [pending, setPending] = useState(false);
  const [alt, setAlt] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  /** Вариант, к которому привязать снимки; '' — общее фото товара. */
  const [variantId, setVariantId] = useState('');
  /** Прогресс партии: без него при 10 файлах кнопка просто «висит». */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function upload() {
    const files = Array.from(fileRef.current?.files ?? []);
    if (files.length === 0) {
      setError({ ok: false, error: 'validation', fieldErrors: { file: ['Выберите файл.'] } });
      return;
    }
    setPending(true);
    setError(null);
    setProgress(null);

    // Загрузка ПОСЛЕДОВАТЕЛЬНАЯ, а не Promise.all: attachMedia внутри себя
    // разбирается с «главным» фото (FOR UPDATE на текущем главном), и параллельные
    // вызовы сериализовались бы на этой строке, только вперемешку — порядок
    // снимков стал бы случайным. Здесь порядок = порядок выбора файлов.
    let uploaded = 0;
    for (const [i, file] of files.entries()) {
      setProgress({ done: i, total: files.length });
      const fd = new FormData();
      fd.set('file', file);
      // Подпись общая для партии — она описывает товар, а не конкретный кадр.
      fd.set('alt', alt);
      // «Сделать главным» применяем ТОЛЬКО к первому файлу: иначе каждый
      // следующий перебивал бы предыдущего и главным стал бы последний.
      fd.set('isPrimary', isPrimary && i === 0 ? 'true' : 'false');
      fd.set('variantId', variantId);
      const result = await uploadMediaAction(product.id, fd);
      if (!result.ok) {
        // Частичный успех — честно говорим, сколько прошло: файлы до сбоя уже
        // в хранилище, и повторная загрузка всей партии создала бы дубли.
        setError(
          uploaded > 0
            ? { ...result, message: `Загружено ${uploaded} из ${files.length}. ${errorMessage(result)}` }
            : result,
        );
        setPending(false);
        setProgress(null);
        router.refresh();
        return;
      }
      uploaded += 1;
    }

    setPending(false);
    setProgress(null);
    setAlt('');
    setIsPrimary(false);
    setVariantId('');
    if (fileRef.current) fileRef.current.value = '';
    router.refresh();
  }

  /** Подпись привязки снимка: имя варианта или «общее фото товара». */
  function variantLabel(id: string | null): string {
    if (!id) return 'Общее фото';
    const v = product.variants.find((x) => x.id === id);
    // Вариант могли удалить — привязка обнуляется (ON DELETE SET NULL), но до
    // перезагрузки страницы ссылка может остаться: не врём, пишем честно.
    return v ? (v.name || v.sku) : 'Вариант удалён';
  }

  async function makePrimary(id: string) {
    setError(null);
    const order = product.media.map((m) => m.id);
    const result = await reorderMediaAction({ productId: product.id, order, primaryId: id });
    if (result.ok) router.refresh();
    else setError(result);
  }

  async function remove(id: string) {
    if (!window.confirm('Удалить изображение?')) {
      return;
    }
    setError(null);
    const result = await deleteMediaAction({ id });
    if (result.ok) router.refresh();
    else setError(result);
  }

  return (
    <div>
      {error ? (
        <div role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {errorMessage(error)}
          {error.fieldErrors?.file ? ` ${error.fieldErrors.file[0]}` : ''}
        </div>
      ) : null}

      {product.media.length === 0 ? (
        <p className="text-sm text-gray-500">Медиафайлов пока нет.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {product.media.map((m) => (
            <li key={m.id} className="rounded border border-gray-200 p-2">
              {m.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.alt} className="h-28 w-full rounded object-cover" />
              ) : (
                <div className="flex h-28 w-full items-center justify-center rounded bg-gray-100 text-xs text-gray-400">
                  нет превью
                </div>
              )}
              {/* К какому варианту привязан снимок: без этой подписи владелец
                  не увидит, что фото ушло не в тот цвет (п.2/п.4). */}
              <p className="mt-1 truncate text-[11px] text-gray-500" title={variantLabel(m.variantId)}>
                {variantLabel(m.variantId)}
              </p>
              <div className="mt-2 flex items-center justify-between text-xs">
                {m.isPrimary ? (
                  <span className="font-medium text-green-700">главное</span>
                ) : (
                  <button type="button" onClick={() => makePrimary(m.id)} className="text-blue-700 hover:underline">
                    сделать главным
                  </button>
                )}
                <button type="button" onClick={() => remove(m.id)} className="text-red-600 hover:underline">
                  удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h3 className="text-sm font-semibold text-gray-800">Загрузить изображения</h3>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="m-file" className="block text-xs font-medium text-gray-600">
              Файлы
            </label>
            <input
              id="m-file"
              ref={fileRef}
              type="file"
              accept="image/*"
              // Мультизагрузка (правка владельца п.4): выбирается сразу пачка
              // снимков, как на маркетплейсах. Порядок загрузки = порядок выбора.
              multiple
              className="mt-1 w-full text-sm"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Можно выбрать сразу несколько файлов
            </p>
          </div>
          {/* Привязка к варианту — то, что заставляет витрину менять фото при
              выборе цвета (п.2). Без неё снимки остаются «общими» и показываются
              для любого цвета. */}
          {product.variants.length > 0 ? (
            <div>
              <label htmlFor="m-variant" className="block text-xs font-medium text-gray-600">
                Вариант (цвет/размер)
              </label>
              <select
                id="m-variant"
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Общее фото товара</option>
                {product.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name || v.sku}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-gray-500">
                Витрина покажет эти фото при выборе цвета варианта
              </p>
            </div>
          ) : null}
          <div>
            <label htmlFor="m-alt" className="block text-xs font-medium text-gray-600">Подпись к фото</label>
            <input
              id="m-alt"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <label className="flex items-end gap-2 pb-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            сделать главным
          </label>
        </div>
        <button
          type="button"
          onClick={upload}
          disabled={pending}
          className="mt-3 rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pending
            ? progress && progress.total > 1
              ? `Загрузка… ${progress.done + 1} из ${progress.total}`
              : 'Загрузка…'
            : 'Загрузить'}
        </button>
      </div>
    </div>
  );
}
