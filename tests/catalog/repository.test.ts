import { describe, expect, it } from 'vitest';

import {
  mapCategory,
  mapProduct,
  mapVariant,
  mapAttribute,
  mapMedia,
  mapInventory,
  buildCategoryTree,
} from '@/lib/catalog/repository';
import { buildAttributesCache } from '@/lib/catalog/cache';
import type { Category } from '@/lib/catalog/types';

// ЮНИТ: маппинг row(snake_case)→domain(camelCase) и сборка дерева — без БД.

describe('mapCategory', () => {
  it('маппит поля и нормализует null', () => {
    const c = mapCategory({
      id: 'c1',
      parent_id: null,
      slug: 'cat',
      name: 'Кат',
      description: 'd',
      sort: '3',
      is_active: true,
      seo_title: null,
      seo_description: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
    expect(c.parentId).toBeNull();
    expect(c.sort).toBe(3);
    expect(c.isActive).toBe(true);
    expect(c.createdAt).toBeInstanceOf(Date);
  });
});

describe('mapProduct', () => {
  it('basePrice как строка, attributes_cache парсится', () => {
    const p = mapProduct({
      id: 'p1',
      sku: 'S',
      slug: 's',
      name: 'N',
      description: '',
      status: 'active',
      base_price: '199.90',
      attributes_cache: '{"color":"red"}',
      created_at: new Date(),
      updated_at: new Date(),
    });
    expect(p.basePrice).toBe('199.90');
    expect(p.status).toBe('active');
    expect(p.attributesCache).toEqual({ color: 'red' });
  });
});

describe('mapVariant', () => {
  it('priceOverride null сохраняется, priceDelta строкой', () => {
    const v = mapVariant({
      id: 'v1',
      product_id: 'p1',
      sku: 'V',
      name: '',
      price_override: null,
      price_delta: '10.00',
      is_active: true,
      sort: 0,
      attributes_cache: {},
      created_at: new Date(),
      updated_at: new Date(),
    });
    expect(v.priceOverride).toBeNull();
    expect(v.priceDelta).toBe('10.00');
  });
});

describe('mapAttribute / mapMedia / mapInventory', () => {
  it('булевы и числа приводятся', () => {
    const a = mapAttribute({
      id: 'a', code: 'color', name: 'Цвет', type: 'select', unit: null,
      is_variant: true, is_filterable: false, is_required: false, sort: '1',
      created_at: new Date(), updated_at: new Date(),
    });
    expect(a.isVariant).toBe(true);
    expect(a.isFilterable).toBe(false);
    expect(a.sort).toBe(1);

    const m = mapMedia({
      id: 'm', product_id: 'p', variant_id: null, storage_key: 'k', url: 'u',
      type: 'image', mime: 'image/webp', alt: '', width: '800', height: '600',
      size_bytes: '1234', sort: 0, is_primary: true, created_at: new Date(),
    });
    expect(m.width).toBe(800);
    expect(m.sizeBytes).toBe(1234);
    expect(m.isPrimary).toBe(true);

    const i = mapInventory({
      id: 'i', product_id: 'p', variant_id: 'v', warehouse_code: 'main',
      quantity: '5', reserved: '2', updated_at: new Date(),
    });
    expect(i.quantity).toBe(5);
    expect(i.reserved).toBe(2);
  });
});

describe('buildCategoryTree', () => {
  function cat(id: string, parentId: string | null, sort = 0): Category {
    return {
      id, parentId, slug: id, name: id, description: '', sort, isActive: true,
      seoTitle: null, seoDescription: null, createdAt: new Date(), updatedAt: new Date(),
    };
  }

  it('собирает иерархию из плоского списка', () => {
    const tree = buildCategoryTree([
      cat('a', null), cat('b', 'a'), cat('c', 'a'), cat('d', 'b'), cat('e', null),
    ]);
    const ids = tree.map((n) => n.id).sort();
    expect(ids).toEqual(['a', 'e']);
    const a = tree.find((n) => n.id === 'a')!;
    expect(a.children.map((c) => c.id).sort()).toEqual(['b', 'c']);
    const b = a.children.find((c) => c.id === 'b')!;
    expect(b.children.map((c) => c.id)).toEqual(['d']);
  });

  it('сирота с несуществующим родителем становится корнем', () => {
    const tree = buildCategoryTree([cat('x', 'missing')]);
    expect(tree.map((n) => n.id)).toEqual(['x']);
  });
});

describe('buildAttributesCache', () => {
  it('одно значение → скаляр, несколько → массив', () => {
    const cache = buildAttributesCache([
      { code: 'color', value: 'red' },
      { code: 'size', value: 'M' },
      { code: 'size', value: 'L' },
    ]);
    expect(cache.color).toBe('red');
    expect(cache.size).toEqual(['M', 'L']);
  });
  it('пустой вход → пустой объект', () => {
    expect(buildAttributesCache([])).toEqual({});
  });
});
