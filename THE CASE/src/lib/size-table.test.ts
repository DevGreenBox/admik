import { describe, it, expect } from 'vitest';
import { selectSizeCharts, getCell, type SizeChart } from './size-table';

const women: SizeChart = {
  id: 'women',
  title: 'Женская размерная сетка',
  note: 'рост 165-172',
  genders: ['women', 'женский', 'жен'],
  columns: [
    { key: 'size', label: 'Размер' },
    { key: 'chest', label: 'Обхват груди, см' },
  ],
  rows: [{ size: '42 XS', chest: '84' }],
};

const men: SizeChart = {
  id: 'men',
  title: 'Мужская размерная сетка',
  genders: ['men', 'мужской', 'муж'],
  columns: [
    { key: 'size', label: 'Размер' },
    { key: 'chest', label: 'Обхват груди, см' },
  ],
  rows: [{ size: '48 M', chest: '96' }],
};

const always: SizeChart = {
  id: 'shoes',
  title: 'Обувь',
  genders: [],
  columns: [{ key: 'size', label: 'Размер' }],
  rows: [{ size: '41' }],
};

const ids = (list: SizeChart[]) => list.map((c) => c.id);

describe('selectSizeCharts', () => {
  it('пустой список сеток → пустой результат при любом gender', () => {
    expect(selectSizeCharts([], 'women')).toEqual([]);
    expect(selectSizeCharts([], null)).toEqual([]);
    expect(selectSizeCharts(null, 'men')).toEqual([]);
    expect(selectSizeCharts(undefined, 'men')).toEqual([]);
  });

  it('gender "men"/"мужской" → мужская сетка', () => {
    expect(ids(selectSizeCharts([women, men], 'men'))).toEqual(['men']);
    expect(ids(selectSizeCharts([women, men], 'мужской'))).toEqual(['men']);
    expect(ids(selectSizeCharts([women, men], 'муж'))).toEqual(['men']);
  });

  it('gender "women"/"женский" → женская сетка', () => {
    expect(ids(selectSizeCharts([women, men], 'women'))).toEqual(['women']);
    expect(ids(selectSizeCharts([women, men], 'женский'))).toEqual(['women']);
  });

  it('нормализация: регистр и пробелы по краям', () => {
    expect(ids(selectSizeCharts([women, men], '  WOMEN '))).toEqual(['women']);
    expect(ids(selectSizeCharts([women, men], 'Мужской'))).toEqual(['men']);
  });

  it('нормализация ё → е ("жёнский" совпадает с "женский")', () => {
    expect(ids(selectSizeCharts([women, men], 'жёнский'))).toEqual(['women']);
  });

  it('нормализация ё → е работает и со стороны настройки', () => {
    const chart: SizeChart = { ...women, id: 'w2', genders: ['Жёнский'] };
    expect(ids(selectSizeCharts([chart, men], 'женский'))).toEqual(['w2']);
  });

  it('регрессия: unisex/пустой/мусорный gender → ВСЕ сетки, а не женская', () => {
    for (const g of ['unisex', 'унисекс', '', '   ', 'qwerty', null, undefined]) {
      expect(ids(selectSizeCharts([women, men], g))).toEqual(['women', 'men']);
    }
  });

  it('сетка с genders: [] подходит всегда', () => {
    expect(ids(selectSizeCharts([women, men, always], 'men'))).toEqual(['men', 'shoes']);
    expect(ids(selectSizeCharts([always], 'women'))).toEqual(['shoes']);
    // Подошла хотя бы одна (always) → фолбэк «вернуть все» НЕ срабатывает.
    expect(ids(selectSizeCharts([women, men, always], 'unisex'))).toEqual(['shoes']);
  });

  it('порядок сеток сохраняется как в настройке', () => {
    // Фолбэк «все сетки» отдаёт их в исходном порядке.
    expect(ids(selectSizeCharts([men, women], 'unisex'))).toEqual(['men', 'women']);
    // Отбор по gender тоже не переставляет: always-сетка стоит первой в настройке.
    expect(ids(selectSizeCharts([always, women, men], 'мужской'))).toEqual(['shoes', 'men']);
  });

  it('не мутирует входной массив', () => {
    const input = [women, men];
    selectSizeCharts(input, 'men');
    expect(ids(input)).toEqual(['women', 'men']);
  });
});

/**
 * Доступ к ячейке строки (security-review спринта A, находка №3).
 *
 * Ключи колонок задаёт контент-менеджер, а строка — обычный объект, поэтому
 * `row[col.key]` для ключа-члена Object.prototype («toString», «constructor»,
 * «valueOf») возвращает ФУНКЦИЮ из прототипа, а не отсутствие значения.
 * Оператор `??` её не отсекает — она непустая. React на такой ячейке пишет в
 * консоль «Functions are not valid as a React child» и рендерит пустой <td>.
 *
 * Поэтому чтение ячейки идёт только через own-свойства.
 */
describe('size-table — getCell', () => {
  it('возвращает значение ячейки, когда оно задано', () => {
    expect(getCell({ size: '42 XS', chest: '84' }, 'chest')).toBe('84');
  });

  it('возвращает прочерк, когда ячейки нет (пустую ячейку форма не сохраняет)', () => {
    expect(getCell({ size: '42 XS' }, 'chest')).toBe('—');
  });

  it('пустая строка остаётся пустой строкой, а не превращается в прочерк', () => {
    expect(getCell({ chest: '' }, 'chest')).toBe('');
  });

  it.each(['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'ключ «%s» не проваливается в прототип и даёт прочерк',
    (key) => {
      const value = getCell({ size: '42 XS' }, key);
      expect(typeof value).toBe('string');
      expect(value).toBe('—');
    },
  );

  it('own-свойство с именем члена прототипа читается нормально', () => {
    expect(getCell({ toString: '104' }, 'toString')).toBe('104');
  });
});
