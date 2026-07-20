import { describe, expect, it } from 'vitest';

import {
  buildAttributeValuePayload,
  buildAttributeValueUpdatePayload,
  normalizeHexInput,
} from '@/app/admin/(panel)/catalog/attributes/_components/payload';
import { AttributeValueSchema, AttributeValueUpdateSchema } from '@/lib/catalog/schemas';
import { normalizeColorHex } from '@/lib/catalog/color';

/**
 * HEX цвета в словаре значений (attribute_values.color_hex, миграция 0036):
 * нормализация ввода формы и стыковка payload'а со схемами Zod.
 *
 * Ключевое: невалидный ввод НЕ проглатывается молча — он доезжает до Zod и
 * владелец видит ошибку. Иначе набранный с опечаткой hex «сохранился бы»
 * пустым, и редактор считал бы свотч заведённым.
 */

describe('normalizeHexInput', () => {
  it('добавляет решётку и приводит к верхнему регистру', () => {
    expect(normalizeHexInput('ffffff')).toBe('#FFFFFF');
    expect(normalizeHexInput('#a1b2c3')).toBe('#A1B2C3');
  });

  it('разворачивает трёхсимвольное сокращение', () => {
    expect(normalizeHexInput('#fff')).toBe('#FFFFFF');
    expect(normalizeHexInput('abc')).toBe('#AABBCC');
  });

  it('пустой ввод → undefined (поле не передаётся)', () => {
    expect(normalizeHexInput('')).toBeUndefined();
    expect(normalizeHexInput('   ')).toBeUndefined();
    expect(normalizeHexInput(undefined)).toBeUndefined();
  });

  it('мусор возвращается как есть — чтобы его отверг Zod, а не тишина', () => {
    expect(normalizeHexInput('красный')).toBe('красный');
    expect(normalizeHexInput('#12345')).toBe('#12345');
  });

  it('результат нормализации всегда проходит серверную проверку формата', () => {
    for (const raw of ['fff', '#FFF', 'a1b2c3', '#A1B2C3']) {
      expect(normalizeColorHex(normalizeHexInput(raw)!)).not.toBeNull();
    }
  });
});

describe('buildAttributeValuePayload — hex', () => {
  const ATTR = '99999999-9999-4999-8999-999999999999';

  it('валидный hex доезжает до схемы создания значения', () => {
    const payload = buildAttributeValuePayload(ATTR, {
      value: 'Белый',
      colorHex: '#fff',
    });
    expect(payload.colorHex).toBe('#FFFFFF');

    const parsed = AttributeValueSchema.safeParse(payload);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    if (parsed.success) expect(parsed.data.colorHex).toBe('#FFFFFF');
  });

  it('без hex значение всё равно создаётся (цвет без свотча допустим)', () => {
    const payload = buildAttributeValuePayload(ATTR, { value: 'Белый' });
    expect(payload.colorHex).toBeUndefined();
    expect(AttributeValueSchema.safeParse(payload).success).toBe(true);
  });

  it('битый hex отвергается схемой, а не сохраняется молча', () => {
    const payload = buildAttributeValuePayload(ATTR, {
      value: 'Белый',
      colorHex: 'белый',
    });
    expect(AttributeValueSchema.safeParse(payload).success).toBe(false);
  });
});

describe('buildAttributeValueUpdatePayload — hex', () => {
  const ID = '88888888-8888-4888-8888-888888888888';

  it('пустая строка = ОЧИСТКА hex (null), а не «не трогать»', () => {
    const payload = buildAttributeValueUpdatePayload(ID, { colorHex: '' });
    expect(payload.colorHex).toBeNull();
    const parsed = AttributeValueUpdateSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.colorHex).toBeNull();
  });

  it('поле не передано = «не трогать» (undefined)', () => {
    const payload = buildAttributeValueUpdatePayload(ID, {});
    expect(payload.colorHex).toBeUndefined();
    expect('colorHex' in payload && payload.colorHex !== undefined).toBe(false);
  });

  it('валидный hex нормализуется и проходит схему', () => {
    const payload = buildAttributeValueUpdatePayload(ID, { colorHex: 'abc' });
    expect(payload.colorHex).toBe('#AABBCC');
    expect(AttributeValueUpdateSchema.safeParse(payload).success).toBe(true);
  });
});
