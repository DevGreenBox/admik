/**
 * Ошибки домена orders.
 *
 * Вынесено в отдельный модуль (а не в actions.ts), потому что actions.ts помечен
 * директивой `'use server'`, а такой модуль может экспортировать ТОЛЬКО async-функции
 * (ограничение Next.js Server Actions). Класс ошибки — не функция, поэтому живёт здесь
 * (как lib/catalog/errors.ts).
 */

/** Ошибка домена заказов/промокодов — ловится/маппится в actions (defineAction → 'internal'). */
export class OrderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'OrderError';
  }
}
