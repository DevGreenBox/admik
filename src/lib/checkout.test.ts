import { describe, it, expect } from 'vitest';
import {
  cartToItems,
  formatEta,
  isContactStepValid,
  isDeliveryStepValid,
  fullName,
} from './checkout';
import type { CartItem } from '@/types';

function item(over: Partial<CartItem> = {}): CartItem {
  return {
    variantId: 'v1',
    slug: 'halat',
    name: 'Халат',
    size: 'M',
    price: 4900,
    imageUrl: null,
    quantity: 1,
    ...over,
  };
}

describe('cartToItems', () => {
  it('маппит cart → [{variantId, qty}] (только то, что нужно quote/order)', () => {
    const cart = [
      item({ variantId: 'a', quantity: 2 }),
      item({ variantId: 'b', quantity: 1 }),
    ];
    expect(cartToItems(cart)).toEqual([
      { variantId: 'a', qty: 2 },
      { variantId: 'b', qty: 1 },
    ]);
  });

  it('пустая корзина → []', () => {
    expect(cartToItems([])).toEqual([]);
  });
});

describe('formatEta', () => {
  it('разные границы → «N–M дней»', () => {
    expect(formatEta(2, 4)).toBe('2–4 дней');
  });
  it('равные границы → одно число со склонением', () => {
    expect(formatEta(1, 1)).toBe('1 день');
    expect(formatEta(3, 3)).toBe('3 дня');
    expect(formatEta(5, 5)).toBe('5 дней');
  });
  it('только верхняя граница → одно число', () => {
    expect(formatEta(0, 4)).toBe('4 дня');
  });
  it('нулевые/невалидные → пусто', () => {
    expect(formatEta(0, 0)).toBe('');
    expect(formatEta(undefined, undefined)).toBe('');
  });
});

describe('isContactStepValid', () => {
  it('true когда имя/email/телефон заполнены', () => {
    expect(
      isContactStepValid({ firstName: 'Иван', lastName: '', email: 'i@e.ru', phone: '+7' }),
    ).toBe(true);
  });
  it('false если пусто (с учётом пробелов)', () => {
    expect(
      isContactStepValid({ firstName: '  ', lastName: 'П', email: 'i@e.ru', phone: '+7' }),
    ).toBe(false);
    expect(
      isContactStepValid({ firstName: 'И', lastName: '', email: '', phone: '+7' }),
    ).toBe(false);
  });
  it('false при невалидном формате email (ранний гейт, не доводим до сервера)', () => {
    expect(
      isContactStepValid({ firstName: 'Иван', lastName: 'П', email: 'неэмейл', phone: '+7' }),
    ).toBe(false);
    expect(
      isContactStepValid({ firstName: 'Иван', lastName: 'П', email: 'a@b', phone: '+7' }),
    ).toBe(false);
    expect(
      isContactStepValid({ firstName: 'Иван', lastName: 'П', email: 'a@b.ru', phone: '+7' }),
    ).toBe(true);
  });
});

describe('isDeliveryStepValid', () => {
  it('true только когда есть город и ПВЗ', () => {
    expect(isDeliveryStepValid(44, 'MSK1')).toBe(true);
    expect(isDeliveryStepValid(null, 'MSK1')).toBe(false);
    expect(isDeliveryStepValid(44, null)).toBe(false);
    expect(isDeliveryStepValid(44, '')).toBe(false);
  });
});

describe('fullName', () => {
  it('склеивает имя и фамилию, тримит', () => {
    expect(fullName({ firstName: 'Иван', lastName: 'Петров' })).toBe('Иван Петров');
    expect(fullName({ firstName: 'Иван', lastName: '' })).toBe('Иван');
  });
});
