import { describe, it, expect } from 'vitest';
import { appliedPromoCode, isPromoInSync, type QuotePromo } from './promo';

function promo(over: Partial<QuotePromo> = {}): QuotePromo {
  return { applied: true, code: 'SALE10', discount: '500', reason: null, ...over };
}

describe('appliedPromoCode', () => {
  it('применённый код → отправляем именно его (источник истины — сервер)', () => {
    expect(appliedPromoCode(promo({ applied: true, code: 'SALE10' }))).toBe('SALE10');
  });

  it('промо не применён → отправлять нечего (undefined), даже если code задан', () => {
    expect(appliedPromoCode(promo({ applied: false, code: 'SALE10' }))).toBeUndefined();
  });

  it('null/undefined quote.promo → undefined', () => {
    expect(appliedPromoCode(null)).toBeUndefined();
    expect(appliedPromoCode(undefined)).toBeUndefined();
  });

  it('applied=true, но code=null/пустой → undefined (нечего слать)', () => {
    expect(appliedPromoCode(promo({ applied: true, code: null }))).toBeUndefined();
    expect(appliedPromoCode(promo({ applied: true, code: '  ' }))).toBeUndefined();
  });

  it('обрезает пробелы у применённого кода', () => {
    expect(appliedPromoCode(promo({ applied: true, code: '  SALE10 ' }))).toBe('SALE10');
  });
});

describe('isPromoInSync', () => {
  it('пустой ввод и нет применённого промо → синхронизировано', () => {
    expect(isPromoInSync('', null)).toBe(true);
    expect(isPromoInSync('   ', promo({ applied: false, code: null }))).toBe(true);
  });

  it('ввод точно совпадает с применённым кодом → синхронизировано', () => {
    expect(isPromoInSync('SALE10', promo({ applied: true, code: 'SALE10' }))).toBe(true);
  });

  it('совпадение без учёта регистра/пробелов → синхронизировано (поле uppercase)', () => {
    expect(isPromoInSync(' sale10 ', promo({ applied: true, code: 'SALE10' }))).toBe(true);
  });

  it('правка поля после применения (другой текст) → РАССИНХРОН', () => {
    // покупатель применил SALE10, увидел скидку, затем дописал символ
    expect(isPromoInSync('SALE100', promo({ applied: true, code: 'SALE10' }))).toBe(false);
  });

  it('очистка поля после применения → РАССИНХРОН (итог со скидкой недействителен)', () => {
    expect(isPromoInSync('', promo({ applied: true, code: 'SALE10' }))).toBe(false);
  });

  it('ввёл новый код, но промо ещё не применён сервером → РАССИНХРОН', () => {
    expect(isPromoInSync('NEWCODE', promo({ applied: false, code: null }))).toBe(false);
  });
});
