import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * C8-2 (аудит цикла 8): defaultHasPublishedCmsPages строит ВАЛИДНЫЙ SQL.
 *
 * Регресс: прежде запрос был `SELECT EXISTS(...) AS exists WHERE to_regclass(...)` —
 * top-level WHERE без FROM → синтаксическая ошибка PostgreSQL → catch → ВСЕГДА false
 * (предупреждение «есть опубликованные CMS-страницы» при выключении модуля cms не
 * показывалось). Фикс: to_regclass-гард внутри подзапроса EXISTS (там есть FROM
 * cms_pages), как в lib/seo/repository.ts. sql замокан (захватываем текст запроса).
 */

const h = vi.hoisted(() => {
  const state = { rows: [{ exists: true }] as unknown[], throwIt: false, lastQuery: '' };
  const sql = vi.fn((strings: TemplateStringsArray) => {
    state.lastQuery = strings.join('?');
    if (state.throwIt) {
      return Promise.reject(new Error('relation "cms_pages" does not exist'));
    }
    return Promise.resolve(state.rows);
  });
  return { state, sql };
});

vi.mock('@/lib/db/client', () => ({ sql: h.sql }));

import { defaultHasPublishedCmsPages } from '@/lib/settings/action-factory';

const { state } = h;

beforeEach(() => {
  state.rows = [{ exists: true }];
  state.throwIt = false;
  state.lastQuery = '';
  h.sql.mockClear();
});

describe('settings/action-factory — defaultHasPublishedCmsPages (C8-2: валидный SQL)', () => {
  it('EXISTS вернул exists:true → true (предупреждение покажется)', async () => {
    state.rows = [{ exists: true }];
    expect(await defaultHasPublishedCmsPages()).toBe(true);
  });

  it('EXISTS вернул exists:false → false', async () => {
    state.rows = [{ exists: false }];
    expect(await defaultHasPublishedCmsPages()).toBe(false);
  });

  it('таблица отсутствует/ошибка чтения → catch → false (толерантность)', async () => {
    state.throwIt = true;
    expect(await defaultHasPublishedCmsPages()).toBe(false);
  });

  it('C8-2: to_regclass-гард ВНУТРИ подзапроса EXISTS, а не top-level WHERE без FROM', async () => {
    await defaultHasPublishedCmsPages();
    const q = state.lastQuery.toLowerCase();
    const idxRegclass = q.indexOf('to_regclass');
    const idxAsExists = q.indexOf('as exists');
    expect(idxRegclass).toBeGreaterThanOrEqual(0);
    // to_regclass должен идти ДО "as exists" → значит внутри подзапроса (FROM cms_pages),
    // а не после закрытия EXISTS (что было бы синтаксически невалидным top-level WHERE).
    expect(idxAsExists).toBeGreaterThan(idxRegclass);
  });
});
