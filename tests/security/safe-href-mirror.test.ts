import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { isSafeHref } from '@/lib/security/safe-href';

/**
 * СТРАЖ РАСХОЖДЕНИЯ ЗЕРКАЛА (доработка находки #11).
 *
 * Правило href существует в ДВУХ файлах, и это вынужденно: у витрины
 * («THE CASE/») отдельный tsconfig/пакет, импорт из корня admik невозможен.
 *   • lib/security/safe-href.ts        — источник правды (admik, валидация НА ЗАПИСИ);
 *   • «THE CASE/src/lib/safe-href.ts»  — зеркало (витрина, гвард НА РЕНДЕРЕ).
 *
 * Ровно этот паттерн («две функции с одним именем») и был находкой #11: правило
 * чинят в одном файле, а трафик идёт через второй. Сейчас копии синхронны, но
 * удерживает их только КОММЕНТАРИЙ — то есть ничто. Достаточно ужесточить правило
 * в admik и забыть про витрину: значение, записанное ДО ужесточения (или напрямую
 * через SQL), пройдёт ослабевшее зеркало и уедет в <a href> витрины.
 *
 * Тест сравнивает ЛОГИКУ обоих модулей на едином списке payload'ов, а не текст
 * файлов: зеркало легально содержит лишнюю safeHrefOr(), а источник — экспортируемое
 * сообщение для Zod. Расходится ПОВЕДЕНИЕ — тест падает.
 */

const MIRROR_PATH = path.resolve(
  __dirname,
  '../../THE CASE/src/lib/safe-href.ts',
);

/**
 * Загружает зеркало витрины без её tsconfig/alias: берём исходник, срезаем
 * TS-аннотации не можем — поэтому импортируем через vite (vitest трансформирует
 * .ts по абсолютному пути).
 */
async function loadMirror(): Promise<{
  isSafeHref: (v: unknown) => boolean;
  safeHref: (v: unknown) => string | null;
  safeHrefOr: (v: unknown, fb: string) => string;
}> {
  return (await import(/* @vite-ignore */ MIRROR_PATH)) as never;
}

/**
 * Общий корпус payload'ов: реальные сценарии атаки, а не форма.
 * Любое расхождение вердиктов между admik и витриной = дыра.
 */
const CORPUS = [
  // XSS через схему
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  '  javascript:alert(1)',
  'java\nscript:alert(1)',
  'java\tscript:alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  // Угон домена / open-redirect
  '//evil.example',
  '/\\evil.com',
  '/\\\\evil.com',
  '\\\\evil.com',
  '/catalog\\..\\evil',
  'file:///etc/passwd',
  'ftp://evil.example',
  // Мусор
  'catalog',
  'www.evil.com',
  '',
  '   ',
  // Легитимное
  '/catalog',
  '/catalog?sale=1',
  '/#delivery',
  '#anchor',
  'https://shop.ru/catalog',
  'http://shop.ru',
  'mailto:a@b.c',
  'tel:+79990000000',
] as const;

describe('safe-href: зеркало витрины не должно разойтись с источником правды', () => {
  it('вердикт isSafeHref совпадает на всём корпусе payload’ов', async () => {
    const mirror = await loadMirror();
    const disagreements = CORPUS.filter(
      (v) => isSafeHref(v) !== mirror.isSafeHref(v),
    ).map((v) => ({
      payload: v,
      admik: isSafeHref(v),
      storefront: mirror.isSafeHref(v),
    }));
    expect(disagreements).toEqual([]);
  });

  it('зеркало отвергает «/\\evil.com» (обход через обратный слэш)', async () => {
    const mirror = await loadMirror();
    expect(mirror.isSafeHref('/\\evil.com')).toBe(false);
    expect(mirror.safeHref('/\\evil.com')).toBeNull();
    expect(mirror.safeHrefOr('/\\evil.com', '/catalog')).toBe('/catalog');
  });

  it('в зеркале явно записано, откуда берётся правило (чтобы правку не забыли)', () => {
    const src = readFileSync(MIRROR_PATH, 'utf8');
    expect(src).toMatch(/lib\/security\/safe-href/);
  });
});
