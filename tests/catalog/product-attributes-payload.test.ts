import { describe, expect, it } from 'vitest';

import { buildProductAttributeItems } from '@/app/admin/(panel)/catalog/_components/attributes-payload';
import { SetProductAttributesSchema } from '@/lib/catalog/schemas';
import type { AttributeType } from '@/lib/catalog/types';

/**
 * Сборка payload формы «Характеристики».
 *
 * ЗАЧЕМ ЭТОТ ТЕСТ: setProductAttributes ВСЕГДА удаляет привязки уровня товара
 * (variant_id IS NULL) и привязки тех вариантов, что пришли в items. Значит
 * форма обязана слать ПОЛНЫЙ набор — product-level И variant-level. Раньше
 * секция читала только уровень товара (ранний continue по variantId), и
 * вариантные значения были для неё невидимы: цвет варианта существовал в БД,
 * но форма о нём не знала. Здесь фиксируется, что вариантные привязки
 * проходят через форму НЕТРОНУТЫМИ.
 */

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const SIZE_ATTR = '22222222-2222-4222-8222-222222222222';
const COLOR_ATTR = '33333333-3333-4333-8333-333333333333';
const VARIANT = '44444444-4444-4444-8444-444444444444';
const WHITE = '55555555-5555-4555-8555-555555555555';
const MATERIAL_ATTR = '66666666-6666-4666-8666-666666666666';

function attr(id: string, type: AttributeType) {
  return { id, type };
}

describe('buildProductAttributeItems', () => {
  it('select → valueId, прочие типы → valueText', () => {
    const items = buildProductAttributeItems({
      attributes: [attr(COLOR_ATTR, 'select'), attr(MATERIAL_ATTR, 'text')],
      values: { [COLOR_ATTR]: WHITE, [MATERIAL_ATTR]: 'Хлопок' },
      existing: [],
    });

    expect(items).toEqual([
      { attributeId: COLOR_ATTR, valueId: WHITE },
      { attributeId: MATERIAL_ATTR, valueText: 'Хлопок' },
    ]);
  });

  it('пустые и пробельные значения уровня товара отбрасываются', () => {
    const items = buildProductAttributeItems({
      attributes: [attr(MATERIAL_ATTR, 'text'), attr(SIZE_ATTR, 'text')],
      values: { [MATERIAL_ATTR]: '   ', [SIZE_ATTR]: '' },
      existing: [],
    });

    expect(items).toEqual([]);
  });

  it('ВАРИАНТНЫЕ привязки переносятся в payload без изменений', () => {
    const items = buildProductAttributeItems({
      attributes: [attr(MATERIAL_ATTR, 'text')],
      values: { [MATERIAL_ATTR]: 'Хлопок' },
      existing: [
        {
          variantId: VARIANT,
          attributeId: COLOR_ATTR,
          valueId: WHITE,
          valueText: null,
        },
      ],
    });

    expect(items).toContainEqual({
      attributeId: COLOR_ATTR,
      variantId: VARIANT,
      valueId: WHITE,
    });
  });

  it('РЕГРЕССИЯ: пустая форма уровня товара не уносит с собой цвет варианта', () => {
    const items = buildProductAttributeItems({
      attributes: [attr(MATERIAL_ATTR, 'text')],
      values: {},
      existing: [
        {
          variantId: VARIANT,
          attributeId: COLOR_ATTR,
          valueId: WHITE,
          valueText: null,
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]!.variantId).toBe(VARIANT);
  });

  it('привязки уровня товара из existing НЕ дублируются (их источник — форма)', () => {
    const items = buildProductAttributeItems({
      attributes: [attr(MATERIAL_ATTR, 'text')],
      values: { [MATERIAL_ATTR]: 'Лён' },
      existing: [
        {
          variantId: null,
          attributeId: MATERIAL_ATTR,
          valueId: null,
          valueText: 'Хлопок',
        },
      ],
    });

    expect(items).toEqual([{ attributeId: MATERIAL_ATTR, valueText: 'Лён' }]);
  });

  it('вариантная привязка с текстовым значением сохраняет valueText', () => {
    const items = buildProductAttributeItems({
      attributes: [],
      values: {},
      existing: [
        {
          variantId: VARIANT,
          attributeId: COLOR_ATTR,
          valueId: null,
          valueText: 'Белый',
        },
      ],
    });

    expect(items).toEqual([
      { attributeId: COLOR_ATTR, variantId: VARIANT, valueText: 'Белый' },
    ]);
  });

  it('вариантная привязка без значения вовсе отбрасывается (её отверг бы Zod)', () => {
    const items = buildProductAttributeItems({
      attributes: [],
      values: {},
      existing: [
        {
          variantId: VARIANT,
          attributeId: COLOR_ATTR,
          valueId: null,
          valueText: null,
        },
      ],
    });

    expect(items).toEqual([]);
  });

  it('итоговый payload проходит серверную схему', () => {
    const items = buildProductAttributeItems({
      attributes: [attr(MATERIAL_ATTR, 'text'), attr(COLOR_ATTR, 'select')],
      values: { [MATERIAL_ATTR]: 'Хлопок', [COLOR_ATTR]: WHITE },
      existing: [
        {
          variantId: VARIANT,
          attributeId: COLOR_ATTR,
          valueId: WHITE,
          valueText: null,
        },
      ],
    });

    const parsed = SetProductAttributesSchema.safeParse({
      productId: PRODUCT,
      items,
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});
