/**
 * Ошибки домена orders.
 *
 * Вынесено в отдельный модуль (а не в actions.ts), потому что actions.ts помечен
 * директивой `'use server'`, а такой модуль может экспортировать ТОЛЬКО async-функции
 * (ограничение Next.js Server Actions). Класс ошибки — не функция, поэтому живёт здесь
 * (как lib/catalog/errors.ts).
 */

import { PublicActionError } from '@/lib/server/action';

/**
 * Ошибка домена заказов/промокодов.
 *
 * НАСЛЕДУЕТ PublicActionError (lib/server/action.ts), чтобы её человекочитаемый
 * `message` доходил до UI: пайплайн defineAction маппит `instanceof
 * PublicActionError` в `{ ok:false, error:'validation', message }`. Обычные
 * исключения handler'а превратились бы в `error:'internal'` без текста — и
 * пользователь видел бы «внутреннюю ошибку» вместо доменной причины («Заказ не
 * найден», «Недопустимый переход статуса», «Промокод уже существует» и т.п.).
 *
 * Поле `code` сохраняет машиночитаемый код домена (not_found / invalid_transition
 * / duplicate_code / conflict / out_of_stock / ...), доступный в логах/тестах,
 * не утекающий в UI отдельно от текста сообщения.
 */
export class OrderError extends PublicActionError {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'OrderError';
    Object.setPrototypeOf(this, OrderError.prototype);
  }
}
