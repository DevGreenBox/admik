import type { AttributeType } from '@/lib/catalog/types';

/**
 * Сборка items для setProductAttributes (секция «Характеристики»).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ЧИСТЫЙ МОДУЛЬ: setProductAttributes — операция ПОЛНОЙ
 * ЗАМЕНЫ. Она безусловно удаляет привязки уровня товара (variant_id IS NULL) и
 * привязки тех вариантов, что перечислены в items. Значит любой вызов обязан
 * присылать полный набор, иначе часть данных исчезает молча. Правило легко
 * нарушить в JSX, поэтому оно вынесено сюда и покрыто тестом.
 *
 * РАЗДЕЛЕНИЕ ИСТОЧНИКОВ:
 *  - уровень товара (variantId = null) собирается ИЗ ФОРМЫ (values) — форма им
 *    управляет, пустое значение = «характеристика снята»;
 *  - уровень варианта (variantId != null) переносится ИЗ ТЕКУЩЕГО состояния
 *    товара НЕТРОНУТЫМ — этой формой он не редактируется (цвет варианта
 *    задаётся в секции «Варианты»), но обязан доехать до сервера, иначе
 *    следующая правка характеристик товара обнулила бы смысл вариантного EAV.
 */

/** Метаданные характеристики, нужные для выбора формы значения. */
export interface AttributeTypeRef {
  id: string;
  type: AttributeType;
}

/** Текущая привязка характеристики к товару/варианту (product_attributes). */
export interface ExistingAttributeBinding {
  variantId: string | null;
  attributeId: string;
  valueId: string | null;
  valueText: string | null;
}

/** Элемент items для setProductAttributes. */
export interface ProductAttributeItem {
  attributeId: string;
  variantId?: string;
  valueId?: string;
  valueText?: string;
}

export interface BuildProductAttributeItemsInput {
  /** Справочник характеристик, отображаемых формой уровня товара. */
  attributes: readonly AttributeTypeRef[];
  /** Значения формы: attributeId → введённое значение (valueId для select). */
  values: Record<string, string>;
  /** Все текущие привязки товара — источник вариантного уровня. */
  existing: readonly ExistingAttributeBinding[];
}

export function buildProductAttributeItems(
  input: BuildProductAttributeItemsInput,
): ProductAttributeItem[] {
  const items: ProductAttributeItem[] = [];

  // 1. Уровень товара — из формы.
  for (const attr of input.attributes) {
    const raw = input.values[attr.id]?.trim();
    if (!raw) continue;
    items.push(
      attr.type === 'select'
        ? { attributeId: attr.id, valueId: raw }
        : { attributeId: attr.id, valueText: raw },
    );
  }

  // 2. Уровень вариантов — пас-сквозь текущего состояния. Привязка без
  //    значения невалидна по схеме (нужен valueId или valueText) — такие
  //    строки в БД появиться не должны, но отбрасываем на всякий случай,
  //    чтобы одна битая строка не заблокировала сохранение всей формы.
  for (const b of input.existing) {
    if (!b.variantId) continue;
    if (b.valueId) {
      items.push({
        attributeId: b.attributeId,
        variantId: b.variantId,
        valueId: b.valueId,
      });
    } else if (b.valueText) {
      items.push({
        attributeId: b.attributeId,
        variantId: b.variantId,
        valueText: b.valueText,
      });
    }
  }

  return items;
}
