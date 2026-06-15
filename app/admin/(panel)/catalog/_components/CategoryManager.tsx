'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { CategoryTreeNode } from '@/lib/catalog/types';

import {
  createCategoryAction,
  updateCategoryAction,
  moveCategoryAction,
  deleteCategoryAction,
} from './form-actions';
import { errorMessage } from './action-result';
import type { ActionResult } from '@/lib/server/action';

/**
 * Управление деревом категорий (docs/05 §5.4). Создание/переименование/
 * перемещение (смена родителя)/удаление через Server Actions. Защита от циклов —
 * на бэке (moveCategory); удаление категории с детьми — понятная ошибка RESTRICT.
 */
type Fail = Extract<ActionResult<unknown>, { ok: false }>;

interface FlatOption {
  id: string;
  label: string;
}

function flatten(nodes: CategoryTreeNode[], depth = 0): FlatOption[] {
  const out: FlatOption[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, label: `${'— '.repeat(depth)}${n.name}` });
    out.push(...flatten(n.children, depth + 1));
  }
  return out;
}

export function CategoryManager({ tree }: { tree: CategoryTreeNode[] }) {
  const router = useRouter();
  const [error, setError] = useState<Fail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newParent, setNewParent] = useState('');

  const options = flatten(tree);

  async function run<T>(
    fn: () => Promise<ActionResult<T>>,
    okMsg: string,
  ): Promise<void> {
    setError(null);
    setNotice(null);
    const result = await fn();
    if (result.ok) {
      setNotice(okMsg);
      router.refresh();
    } else {
      setError(result);
    }
  }

  async function create() {
    if (!newName.trim()) return;
    await run(
      () =>
        createCategoryAction({
          name: newName.trim(),
          slug: newSlug.trim() || undefined,
          parentId: newParent || null,
        }),
      'Категория создана.',
    );
    setNewName('');
    setNewSlug('');
    setNewParent('');
  }

  function renderNode(node: CategoryTreeNode, depth: number) {
    return (
      <li key={node.id} className="py-1">
        <div className="flex flex-wrap items-center gap-2" style={{ paddingLeft: depth * 16 }}>
          <span className="text-sm text-gray-800">{node.name}</span>
          <code className="text-xs text-gray-400">/{node.slug}</code>
          {!node.isActive ? <span className="text-xs text-amber-700">(скрыта)</span> : null}

          <button
            type="button"
            onClick={() => {
              const name = window.prompt('Новое название категории', node.name);
              if (name && name.trim()) {
                void run(() => updateCategoryAction({ id: node.id, name: name.trim() }), 'Переименовано.');
              }
            }}
            className="text-xs text-blue-700 hover:underline"
          >
            переименовать
          </button>

          <button
            type="button"
            onClick={() => {
              const parent = window.prompt(
                'ID нового родителя (пусто — в корень)',
                node.parentId ?? '',
              );
              if (parent === null) return;
              void run(
                () => moveCategoryAction({ id: node.id, parentId: parent.trim() || null }),
                'Категория перемещена.',
              );
            }}
            className="text-xs text-blue-700 hover:underline"
          >
            переместить
          </button>

          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Удалить категорию «${node.name}»?`)) {
                void run(() => deleteCategoryAction({ id: node.id }), 'Категория удалена.');
              }
            }}
            className="text-xs text-red-600 hover:underline"
          >
            удалить
          </button>
        </div>
        {node.children.length > 0 ? (
          <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>
        ) : null}
      </li>
    );
  }

  return (
    <div>
      {error ? (
        <div role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMessage(error)}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="mb-3 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {notice}
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-200 p-4">
        {tree.length === 0 ? (
          <p className="text-sm text-gray-500">Категорий пока нет.</p>
        ) : (
          <ul>{tree.map((n) => renderNode(n, 0))}</ul>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h2 className="text-sm font-semibold text-gray-800">Новая категория</h2>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="c-name" className="block text-xs font-medium text-gray-600">Название*</label>
            <input id="c-name" value={newName} onChange={(e) => setNewName(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="c-slug" className="block text-xs font-medium text-gray-600">ЧПУ (slug)</label>
            <input id="c-slug" value={newSlug} onChange={(e) => setNewSlug(e.target.value)}
              placeholder="авто из названия"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="c-parent" className="block text-xs font-medium text-gray-600">Родитель</label>
            <select id="c-parent" value={newParent} onChange={(e) => setNewParent(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">— корень —</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={!newName.trim()}
          className="mt-3 rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          Создать категорию
        </button>
      </div>
    </div>
  );
}
