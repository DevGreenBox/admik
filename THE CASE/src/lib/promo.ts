/**
 * Чистая логика промокода на чекауте THE CASE (без сети/React) — тестируется
 * юнит-тестами (promo.test.ts).
 *
 * Проблема, которую закрывает модуль (находка аудита 19): после клика «Применить»
 * сервер возвращает quote с применённым кодом (quote.promo), и блок сумм рисуется
 * из этого quote. Но если покупатель ПОТОМ правит поле ввода, не нажав «Применить»
 * заново, на экране остаётся старый итог со скидкой, а в createOrder мог уйти
 * другой/непроверенный код. Источник истины и для ПОКАЗА, и для ОТПРАВКИ — один и
 * тот же ПРИМЕНЁННЫЙ сервером код (quote.promo.code при applied=true).
 */

/** Минимальная форма промо-секции серверного quote (см. AdmikQuoteDto.promo). */
export interface QuotePromo {
  applied: boolean;
  code: string | null;
  discount?: string;
  reason?: string | null;
}

/**
 * Код, который реально нужно отправить в createOrder. Это ИМЕННО применённый
 * сервером код (по которому посчитан показанный итог), а НЕ сырое значение поля
 * ввода. Если промо не применён — отправлять нечего (undefined).
 */
export function appliedPromoCode(
  promo: QuotePromo | null | undefined,
): string | undefined {
  if (!promo || !promo.applied) return undefined;
  const code = (promo.code ?? '').trim();
  return code === '' ? undefined : code;
}

/** Нормализация кода для сравнения: trim + верхний регистр (поле — uppercase). */
function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Синхронизирован ли текущий ввод поля с применённым сервером промокодом.
 *
 * - Пустой ввод И нет применённого промо → синхронизировано (промокода просто нет).
 * - Ввод совпадает (без учёта регистра/пробелов) с применённым кодом → синхронизировано.
 * - Иначе (правил поле после применения / ввёл новый код, не нажав «Применить»;
 *   либо очистил применённый код) → рассинхрон: показанный итог недействителен,
 *   нужно нажать «Применить» заново или очистить.
 */
export function isPromoInSync(
  input: string,
  promo: QuotePromo | null | undefined,
): boolean {
  const typed = input.trim();
  const applied = appliedPromoCode(promo);
  if (applied === undefined) return typed === '';
  return normalizeCode(typed) === normalizeCode(applied);
}
