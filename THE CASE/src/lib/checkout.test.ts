import { describe, it, expect } from 'vitest';
import {
  cartToItems,
  formatEta,
  isContactStepValid,
  isDeliveryStepValid,
  fullName,
  formatDeliveryCost,
  issueReasonLabel,
  describeQuoteIssues,
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

describe('formatDeliveryCost (m11)', () => {
  const fmt = (n: number) => `${n}₽`;

  it('доступна и cost>0 → отформатированная цена', () => {
    expect(formatDeliveryCost(350, true, fmt)).toBe('350₽');
  });

  it('доступна и cost=0 → «Бесплатно» (реально бесплатная)', () => {
    expect(formatDeliveryCost(0, true, fmt)).toBe('Бесплатно');
  });

  it('НЕдоступна (available=false) → «Уточняется», даже если cost=0', () => {
    expect(formatDeliveryCost(0, false, fmt)).toBe('Уточняется');
    expect(formatDeliveryCost(350, false, fmt)).toBe('Уточняется');
  });

  it('стоимость не известна (cost=null) → «Уточняется»', () => {
    expect(formatDeliveryCost(null, true, fmt)).toBe('Уточняется');
    expect(formatDeliveryCost(null, false, fmt)).toBe('Уточняется');
  });
});

describe('issueReasonLabel (C25)', () => {
  it('каждый код → RU-подпись', () => {
    expect(issueReasonLabel('out_of_stock')).toBe('Нет в наличии');
    expect(issueReasonLabel('inactive')).toBe('Снят с продажи');
    expect(issueReasonLabel('product_not_found')).toBe('Товар недоступен');
    expect(issueReasonLabel('variant_not_found')).toBe('Товар недоступен');
  });
  it('неизвестный код → fallback (forward-compat)', () => {
    expect(issueReasonLabel('foo')).toBe('Недоступно к заказу');
  });
});

describe('describeQuoteIssues (C25)', () => {
  it('маппит issues в {name, reason} по индексу позиции корзины', () => {
    const cart = [
      item({ variantId: 'a', name: 'Халат' }),
      item({ variantId: 'b', name: 'Костюм' }),
      item({ variantId: 'c', name: 'Брюки' }),
    ];
    expect(
      describeQuoteIssues(
        [
          { index: 0, code: 'out_of_stock' },
          { index: 2, code: 'inactive' },
        ],
        cart,
      ),
    ).toEqual([
      { name: 'Халат', reason: 'Нет в наличии' },
      { name: 'Брюки', reason: 'Снят с продажи' },
    ]);
  });

  it('индекс вне диапазона → «Позиция N» (N = index + 1)', () => {
    const cart = [item({ name: 'Халат' })];
    expect(describeQuoteIssues([{ index: 5, code: 'out_of_stock' }], cart)).toEqual([
      { name: 'Позиция 6', reason: 'Нет в наличии' },
    ]);
  });

  it('пустой список issues → []', () => {
    expect(describeQuoteIssues([], [item()])).toEqual([]);
  });
});
