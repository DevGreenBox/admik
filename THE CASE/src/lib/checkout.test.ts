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
  formatRuPhone,
  isValidRuPhone,
  contactFieldErrors,
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

const FULL_PHONE = '+7 (982) 510-31-76'; // 11 цифр

describe('isContactStepValid', () => {
  it('true когда имя/email заполнены и телефон полный (11 цифр)', () => {
    expect(
      isContactStepValid({ firstName: 'Иван', lastName: '', email: 'i@e.ru', phone: FULL_PHONE }),
    ).toBe(true);
  });
  it('false если имя пусто (с учётом пробелов)', () => {
    expect(
      isContactStepValid({ firstName: '  ', lastName: 'П', email: 'i@e.ru', phone: FULL_PHONE }),
    ).toBe(false);
    expect(
      isContactStepValid({ firstName: 'И', lastName: '', email: '', phone: FULL_PHONE }),
    ).toBe(false);
  });
  it('false при неполном телефоне (правка Ани2 #8: нужны все 11 цифр)', () => {
    expect(
      isContactStepValid({ firstName: 'Иван', lastName: '', email: 'i@e.ru', phone: '+7 (982) 510' }),
    ).toBe(false);
  });
  it('false при невалидном формате email (ранний гейт, не доводим до сервера)', () => {
    expect(
      isContactStepValid({ firstName: 'Иван', lastName: 'П', email: 'неэмейл', phone: FULL_PHONE }),
    ).toBe(false);
    expect(
      isContactStepValid({ firstName: 'Иван', lastName: 'П', email: 'a@b', phone: FULL_PHONE }),
    ).toBe(false);
    expect(
      isContactStepValid({ firstName: 'Иван', lastName: 'П', email: 'a@b.ru', phone: FULL_PHONE }),
    ).toBe(true);
  });
});

describe('formatRuPhone (маска телефона РФ, ≤11 цифр)', () => {
  it('форматирует полный номер', () => {
    expect(formatRuPhone('79825103176')).toBe('+7 (982) 510-31-76');
  });
  it('нормализует ведущую 8 → 7', () => {
    expect(formatRuPhone('89825103176')).toBe('+7 (982) 510-31-76');
  });
  it('не даёт ввести больше 11 цифр', () => {
    expect(formatRuPhone('798251031769999999')).toBe('+7 (982) 510-31-76');
    expect((formatRuPhone('798251031769999999').match(/\d/g) || []).length).toBe(11);
  });
  it('прогрессивно форматирует частичный ввод', () => {
    expect(formatRuPhone('798')).toBe('+7 (98');
    expect(formatRuPhone('7982')).toBe('+7 (982)');
    expect(formatRuPhone('7982510')).toBe('+7 (982) 510');
    expect(formatRuPhone('798251031')).toBe('+7 (982) 510-31');
  });
  it('чистит буквы/символы', () => {
    expect(formatRuPhone('+7 (982) abc 510-31-76')).toBe('+7 (982) 510-31-76');
  });
});

describe('isValidRuPhone', () => {
  it('true только при ровно 11 цифрах', () => {
    expect(isValidRuPhone('+7 (982) 510-31-76')).toBe(true);
    expect(isValidRuPhone('+7 (982) 510-31')).toBe(false);
    expect(isValidRuPhone('')).toBe(false);
  });
});

describe('contactFieldErrors (подсветка полей)', () => {
  it('помечает пустое имя, кривой email и неполный телефон; фамилия необязательна', () => {
    const e = contactFieldErrors({ firstName: '', lastName: '', email: 'bad', phone: '+7 (982)' });
    expect(e).toEqual({ firstName: true, lastName: false, email: true, phone: true });
  });
  it('нет ошибок при валидной форме', () => {
    const e = contactFieldErrors({ firstName: 'Иван', lastName: '', email: 'i@e.ru', phone: FULL_PHONE });
    expect(e).toEqual({ firstName: false, lastName: false, email: false, phone: false });
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
