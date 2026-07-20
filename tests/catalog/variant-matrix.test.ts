import { describe, expect, it } from 'vitest';

import {
  matrixCellKey,
  matrixSkuBase,
  parseMatrixList,
  planVariantMatrix,
  type ExistingMatrixVariant,
} from '@/lib/catalog/variant-matrix';

/**
 * Чистая логика раскладки матрицы «цвет × размер» (спринт B).
 *
 * Тест — первый (TDD). Проверяется ровно то, что запрещено ломать контрактом
 * спринта: имя варианта остаётся МЕТКОЙ РАЗМЕРА (цвет в name не подмешивается,
 * иначе рассыпается фасет размеров каталога), sku не выдумывается (уникален
 * глобально — база подбирается, но не назначается принудительно), а лишние
 * варианты только ДЕАКТИВИРУЮТСЯ, никогда не удаляются (order_items хранят
 * снимок варианта).
 */

function existing(
  over: Partial<ExistingMatrixVariant> & { id: string },
): ExistingMatrixVariant {
  return {
    name: '',
    colorValueId: null,
    isActive: true,
    ...over,
  };
}

const WHITE = { valueId: 'c-white', value: 'Белый' };
const BLACK = { valueId: 'c-black', value: 'Чёрный' };

describe('parseMatrixList', () => {
  it('режет по запятым и переносам строк, чистит пробелы и пустые', () => {
    expect(parseMatrixList(' 42 , 44 \n46,\n\n , 48 ')).toEqual([
      '42',
      '44',
      '46',
      '48',
    ]);
  });

  it('схлопывает дубли, сохраняя порядок первого появления', () => {
    expect(parseMatrixList('M, S, M, L, S')).toEqual(['M', 'S', 'L']);
  });

  it('пустой ввод → пустой список', () => {
    expect(parseMatrixList('   \n , ')).toEqual([]);
  });
});

describe('matrixCellKey', () => {
  it('различает ячейки по паре (цвет, размер)', () => {
    expect(matrixCellKey('c-white', '42')).not.toBe(matrixCellKey('c-black', '42'));
    expect(matrixCellKey('c-white', '42')).not.toBe(matrixCellKey('c-white', '44'));
  });

  it('нормализует пробелы размера и отсутствие цвета', () => {
    expect(matrixCellKey(null, ' 42 ')).toBe(matrixCellKey(null, '42'));
  });

  it('цвет-null не совпадает с цветом, чей id похож на пустую строку', () => {
    expect(matrixCellKey(null, '42')).not.toBe(matrixCellKey('', '42'));
  });
});

describe('matrixSkuBase', () => {
  it('склеивает цвет и размер в транслитерированную базу', () => {
    expect(matrixSkuBase('Белый', '42')).toBe('belyy-42');
  });

  it('без цвета — только размер', () => {
    expect(matrixSkuBase(null, 'XS')).toBe('xs');
  });

  it('нелатинизируемый ввод не даёт пустую базу (иначе ретраи sku встанут)', () => {
    expect(matrixSkuBase(null, '🎉')).toBe('variant');
    expect(matrixSkuBase('', '')).toBe('variant');
  });
});

describe('planVariantMatrix', () => {
  it('строит полное декартово произведение цветов и размеров', () => {
    const plan = planVariantMatrix({
      colors: [WHITE, BLACK],
      sizes: ['42', '44'],
      existing: [],
    });

    expect(plan.create).toHaveLength(4);
    expect(plan.create.map((c) => [c.colorValueId, c.name])).toEqual([
      ['c-white', '42'],
      ['c-white', '44'],
      ['c-black', '42'],
      ['c-black', '44'],
    ]);
    expect(plan.keep).toEqual([]);
    expect(plan.activate).toEqual([]);
    expect(plan.deactivate).toEqual([]);
  });

  it('ИМЯ ВАРИАНТА = РАЗМЕР: цвет в name НЕ подмешивается (фасет размеров)', () => {
    const plan = planVariantMatrix({
      colors: [WHITE, BLACK],
      sizes: ['42 / XS'],
      existing: [],
    });

    expect(plan.create.map((c) => c.name)).toEqual(['42 / XS', '42 / XS']);
    for (const item of plan.create) {
      expect(item.name).not.toContain('Белый');
      expect(item.name).not.toContain('Чёрный');
    }
  });

  it('SKU не выдумывается: в плане только база для подбора, не готовый артикул', () => {
    const plan = planVariantMatrix({
      colors: [WHITE],
      sizes: ['42'],
      existing: [],
    });

    const item = plan.create[0]!;
    expect(item).not.toHaveProperty('sku');
    expect(item.skuBase).toBe('belyy-42');
  });

  it('без цветов матрица вырождается в список размеров (colorValueId = null)', () => {
    const plan = planVariantMatrix({
      colors: [],
      sizes: ['S', 'M'],
      existing: [],
    });

    expect(plan.create.map((c) => [c.colorValueId, c.name])).toEqual([
      [null, 'S'],
      [null, 'M'],
    ]);
  });

  it('уже существующие ячейки не создаются повторно, а попадают в keep', () => {
    const plan = planVariantMatrix({
      colors: [WHITE, BLACK],
      sizes: ['42', '44'],
      existing: [
        existing({ id: 'v1', name: '42', colorValueId: 'c-white' }),
        existing({ id: 'v2', name: '44', colorValueId: 'c-black' }),
      ],
    });

    expect(plan.keep).toEqual(['v1', 'v2']);
    expect(plan.create.map((c) => [c.colorValueId, c.name])).toEqual([
      ['c-white', '44'],
      ['c-black', '42'],
    ]);
  });

  it('совпадение ячейки регистронезависимо к пробелам имени', () => {
    const plan = planVariantMatrix({
      colors: [],
      sizes: ['42'],
      existing: [existing({ id: 'v1', name: '  42  ' })],
    });

    expect(plan.create).toEqual([]);
    expect(plan.keep).toEqual(['v1']);
  });

  it('выключенный вариант, попавший в матрицу, идёт в activate, а не в create', () => {
    const plan = planVariantMatrix({
      colors: [WHITE],
      sizes: ['42'],
      existing: [
        existing({ id: 'v1', name: '42', colorValueId: 'c-white', isActive: false }),
      ],
    });

    expect(plan.create).toEqual([]);
    expect(plan.activate).toEqual(['v1']);
    expect(plan.keep).toEqual([]);
  });

  it('лишние активные варианты деактивируются только по явному флагу', () => {
    const args = {
      colors: [WHITE],
      sizes: ['42'],
      existing: [
        existing({ id: 'v1', name: '42', colorValueId: 'c-white' }),
        existing({ id: 'v2', name: '46', colorValueId: 'c-white' }),
      ],
    };

    expect(planVariantMatrix(args).deactivate).toEqual([]);
    expect(
      planVariantMatrix({ ...args, deactivateMissing: true }).deactivate,
    ).toEqual(['v2']);
  });

  it('лишний УЖЕ выключенный вариант повторно не трогается', () => {
    const plan = planVariantMatrix({
      colors: [],
      sizes: ['42'],
      existing: [existing({ id: 'v2', name: '46', isActive: false })],
      deactivateMissing: true,
    });

    expect(plan.deactivate).toEqual([]);
  });

  it('план НИКОГДА не содержит удалений (order_items хранят снимок варианта)', () => {
    const plan = planVariantMatrix({
      colors: [WHITE],
      sizes: ['42'],
      existing: [existing({ id: 'v9', name: '99' })],
      deactivateMissing: true,
    });

    expect(plan).not.toHaveProperty('delete');
    expect(Object.keys(plan).sort()).toEqual([
      'activate',
      'create',
      'deactivate',
      'keep',
    ]);
  });

  it('пустой список размеров — пустой план (не сносит товар при незаполненной форме)', () => {
    const plan = planVariantMatrix({
      colors: [WHITE, BLACK],
      sizes: [],
      existing: [existing({ id: 'v1', name: '42', colorValueId: 'c-white' })],
      deactivateMissing: true,
    });

    expect(plan).toEqual({ create: [], keep: [], activate: [], deactivate: [] });
  });

  it('дубли размеров и цветов на входе не размножают ячейки', () => {
    const plan = planVariantMatrix({
      colors: [WHITE, { valueId: 'c-white', value: 'Белый' }],
      sizes: ['42', ' 42 ', '44'],
      existing: [],
    });

    expect(plan.create).toHaveLength(2);
    expect(plan.create.map((c) => c.name)).toEqual(['42', '44']);
  });

  it('несколько существующих вариантов на одну ячейку — все в keep, ни один не гасится', () => {
    const plan = planVariantMatrix({
      colors: [],
      sizes: ['42'],
      existing: [
        existing({ id: 'v1', name: '42' }),
        existing({ id: 'v2', name: '42' }),
      ],
      deactivateMissing: true,
    });

    expect(plan.create).toEqual([]);
    expect(plan.keep).toEqual(['v1', 'v2']);
    expect(plan.deactivate).toEqual([]);
  });

  it('sort новых вариантов продолжает существующую нумерацию', () => {
    const plan = planVariantMatrix({
      colors: [],
      sizes: ['S', 'M'],
      existing: [],
      nextSort: 7,
    });

    expect(plan.create.map((c) => c.sort)).toEqual([7, 8]);
  });

  it('в create приходит человекочитаемое значение цвета для аудита/sku', () => {
    const plan = planVariantMatrix({
      colors: [BLACK],
      sizes: ['42'],
      existing: [],
    });

    expect(plan.create[0]!.colorValue).toBe('Чёрный');
    expect(plan.create[0]!.skuBase).toBe('chernyy-42');
  });
});
