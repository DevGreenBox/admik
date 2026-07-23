import { describe, it, expect } from 'vitest';

import { checkoutSettingsSchema, SETTING_KEYS, SETTING_SCHEMAS } from '@/lib/settings/schemas';

/**
 * Настройка `checkout` — режим оформления заказа (правки владельца 2026-07-22).
 *
 * Закрывает два пункта одной настройкой, потому что оба про поведение checkout
 * и оба должны переключаться на КАЖДОМ магазине платформы отдельно, без правки
 * кода (мультитенантность):
 *   • п.7 — `onlinePaymentEnabled: false` → витрина не инициирует эквайринг, а
 *     показывает заглушку и оформляет ЗАЯВКУ («свяжемся с вами»). Нужно, пока у
 *     магазина нет кассы: THE CASE сейчас именно в этом состоянии.
 *   • п.5 — `giftWrapEnabled` + `giftWrapLabel` → пункт «подарочная упаковка» в
 *     корзине. Магазину без упаковки его показывать нельзя.
 *
 * ДЕФОЛТЫ — важная часть контракта: отсутствие настройки НЕ должно менять
 * поведение существующих магазинов. Поэтому онлайн-оплата по умолчанию ВКЛЮЧЕНА
 * (как было до этой правки), а подарочная упаковка ВЫКЛЮЧЕНА (её не было вовсе).
 */
describe('checkoutSettingsSchema', () => {
  it('зарегистрирована как ключ настроек `checkout`', () => {
    expect(SETTING_KEYS).toContain('checkout');
    expect(SETTING_SCHEMAS.checkout).toBe(checkoutSettingsSchema);
  });

  it('пустой объект валиден — все поля опциональны (магазин ничего не задал)', () => {
    const r = checkoutSettingsSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('принимает полный набор полей', () => {
    const r = checkoutSettingsSchema.safeParse({
      onlinePaymentEnabled: false,
      paymentDisabledNotice: 'Оплата пока недоступна — свяжемся с вами.',
      giftWrapEnabled: true,
      giftWrapLabel: 'Упаковать в подарочную упаковку',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.onlinePaymentEnabled).toBe(false);
      expect(r.data.giftWrapEnabled).toBe(true);
    }
  });

  it('обрезает пробелы в текстах и отбрасывает пустые строки', () => {
    // Пустой текст = «владелец очистил поле» → должен вести себя как «не задано»
    // (витрина покажет свой дефолт), а не рисовать пустую плашку.
    const r = checkoutSettingsSchema.safeParse({
      paymentDisabledNotice: '   ',
      giftWrapLabel: '  Подарочная упаковка  ',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.paymentDisabledNotice).toBeUndefined();
      expect(r.data.giftWrapLabel).toBe('Подарочная упаковка');
    }
  });

  it('отбрасывает посторонние поля (strip), а не падает', () => {
    const r = checkoutSettingsSchema.safeParse({ onlinePaymentEnabled: true, hacked: 'x' });
    expect(r.success).toBe(true);
    if (r.success) expect('hacked' in r.data).toBe(false);
  });

  it('нестроковый текст и нечисловой флаг — ошибка валидации', () => {
    expect(checkoutSettingsSchema.safeParse({ onlinePaymentEnabled: 'yes' }).success).toBe(false);
    expect(checkoutSettingsSchema.safeParse({ giftWrapLabel: 42 }).success).toBe(false);
  });
});
