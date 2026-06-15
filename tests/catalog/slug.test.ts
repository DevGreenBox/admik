import { describe, expect, it } from 'vitest';

import { slugify, isValidSlug, uniquifySlug } from '@/lib/catalog/slug';

// ЮНИТ: генерация slug — чистая, всегда зелёная (без БД).
describe('slugify — транслитерация и нормализация', () => {
  it('кириллица → латиница', () => {
    expect(slugify('Красное платье')).toBe('krasnoe-plate');
    expect(slugify('Тёплый шарф')).toBe('teplyy-sharf');
    expect(slugify('Щётка')).toBe('schetka');
  });

  it('пробелы (в т.ч. множественные) → одиночные дефисы, обрезка краёв', () => {
    expect(slugify('  Hello   World!! ')).toBe('hello-world');
    expect(slugify('a   b')).toBe('a-b');
  });

  it('нижний регистр и цифры сохраняются', () => {
    expect(slugify('iPhone 15 Pro')).toBe('iphone-15-pro');
    expect(slugify('ABC')).toBe('abc');
  });

  it('спецсимволы схлопываются в дефис, без двойных дефисов', () => {
    expect(slugify('foo___bar...baz')).toBe('foo-bar-baz');
    expect(slugify('!!!---!!!')).toBe('');
    expect(slugify('a/b\\c')).toBe('a-b-c');
  });

  it('мягкий/твёрдый знак выпадают', () => {
    expect(slugify('подъезд')).toBe('podezd');
  });
});

describe('isValidSlug', () => {
  it('принимает корректные slug', () => {
    expect(isValidSlug('foo-bar')).toBe(true);
    expect(isValidSlug('abc123')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
  });

  it('отклоняет некорректные', () => {
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('-foo')).toBe(false);
    expect(isValidSlug('foo-')).toBe(false);
    expect(isValidSlug('foo--bar')).toBe(false);
    expect(isValidSlug('Foo')).toBe(false);
    expect(isValidSlug('foo bar')).toBe(false);
    expect(isValidSlug('платье')).toBe(false);
  });

  it('выход slugify всегда валиден (если непуст)', () => {
    for (const s of ['Красное платье', 'iPhone 15', 'a  b  c']) {
      const out = slugify(s);
      expect(isValidSlug(out)).toBe(true);
    }
  });
});

describe('uniquifySlug — кандидаты для ретрая', () => {
  it('attempt 0 → исходный', () => {
    expect(uniquifySlug('foo', 0)).toBe('foo');
  });
  it('attempt N → суффикс -(N+1)', () => {
    expect(uniquifySlug('foo', 1)).toBe('foo-2');
    expect(uniquifySlug('foo', 2)).toBe('foo-3');
  });
});
