import { describe, it, expect } from 'vitest';

import { resolveCheckoutMode, CHECKOUT_MODE_DEFAULTS } from './checkout-mode';
import type { AdmikSettingsDto } from './admik';

/**
 * Режим оформления заказа на витрине (правки владельца 2026-07-22, п.5 и п.7).
 *
 * Главный инвариант — БЕЗОПАСНАЯ ДЕГРАДАЦИЯ: если настройки не пришли (сбой API,
 * старый бэкенд, магазин ничего не задал), витрина обязана вести себя как до
 * появления настройки — оплата включена, подарочной упаковки нет. Иначе сбой
 * запроса настроек молча выключил бы приём платежей на рабочем магазине.
 */

/** Минимальный DTO: заполнено только то, что читает резолвер. */
function dto(checkout?: AdmikSettingsDto['checkout']): AdmikSettingsDto {
  return { checkout } as unknown as AdmikSettingsDto;
}

describe('resolveCheckoutMode', () => {
  it('настройки не пришли (null) → дефолты: оплата включена, упаковки нет', () => {
    const r = resolveCheckoutMode(null);
    expect(r.onlinePaymentEnabled).toBe(true);
    expect(r.giftWrapEnabled).toBe(false);
    expect(r).toEqual(CHECKOUT_MODE_DEFAULTS);
  });

  it('старый бэкенд без поля checkout → те же дефолты', () => {
    expect(resolveCheckoutMode(dto(undefined))).toEqual(CHECKOUT_MODE_DEFAULTS);
    expect(resolveCheckoutMode(dto(null))).toEqual(CHECKOUT_MODE_DEFAULTS);
  });

  it('явный false выключает онлайн-оплату', () => {
    const r = resolveCheckoutMode(dto({ onlinePaymentEnabled: false }));
    expect(r.onlinePaymentEnabled).toBe(false);
  });

  it('null в поле трактуется как «не задано» → дефолт, а не выключение', () => {
    // Бэкенд отдаёт null для незаполненных полей. null НЕ должен читаться как
    // false — иначе оплата выключилась бы сама собой на любом магазине.
    const r = resolveCheckoutMode(dto({ onlinePaymentEnabled: null }));
    expect(r.onlinePaymentEnabled).toBe(true);
  });

  it('текст заглушки берётся из настроек, пустой → дефолтный текст витрины', () => {
    const custom = resolveCheckoutMode(dto({ paymentDisabledNotice: 'Свяжемся в течение дня.' }));
    expect(custom.paymentDisabledNotice).toBe('Свяжемся в течение дня.');

    const blank = resolveCheckoutMode(dto({ paymentDisabledNotice: '   ' }));
    expect(blank.paymentDisabledNotice).toBe(CHECKOUT_MODE_DEFAULTS.paymentDisabledNotice);
    expect(blank.paymentDisabledNotice.length).toBeGreaterThan(0);
  });

  it('подарочная упаковка: включается флагом, подпись — своя или дефолтная', () => {
    const on = resolveCheckoutMode(dto({ giftWrapEnabled: true }));
    expect(on.giftWrapEnabled).toBe(true);
    expect(on.giftWrapLabel).toBe(CHECKOUT_MODE_DEFAULTS.giftWrapLabel);

    const named = resolveCheckoutMode(dto({ giftWrapEnabled: true, giftWrapLabel: 'В подарок' }));
    expect(named.giftWrapLabel).toBe('В подарок');
  });

  it('подпись без включённого флага не включает услугу', () => {
    const r = resolveCheckoutMode(dto({ giftWrapLabel: 'В подарок' }));
    expect(r.giftWrapEnabled).toBe(false);
  });
});
