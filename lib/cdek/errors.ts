/**
 * Ошибки модуля cdek (docs/08 §2 «errors.ts», порт carre Exception.php).
 *
 * Вынесено в отдельный модуль (как lib/catalog/errors.ts), потому что actions.ts
 * помечен `'use server'` и может экспортировать только async-функции. Класс
 * ошибки — не функция, поэтому живёт здесь.
 *
 * CdekError несёт:
 *   * code     — машинный код (наш или код ошибки СДЭК);
 *   * message  — человекочитаемое сообщение;
 *   * cdekErrors — массив структурированных ошибок из тела ответа СДЭК (опц.);
 *   * httpStatus — HTTP-статус ответа СДЭК (опц.).
 */

/** Одна структурированная ошибка из тела ответа СДЭК (`errors[]`). */
export interface CdekApiError {
  code: string;
  message: string;
}

/**
 * Признак сетевой ошибки fetch (включая abort по таймауту). Общий предикат
 * транспортного слоя: используется client.ts (ретраи запросов и чтения тела) и
 * token-cache.ts (ретраи добычи OAuth-токена). undici кидает TypeError («fetch
 * failed») на сетевые сбои и DOMException с name='AbortError' на abort — в
 * Node 18+ DOMException instanceof Error, поэтому одна проверка покрывает оба.
 */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && err.name === 'AbortError');
}

/** Ошибка взаимодействия с СДЭК / домена cdek. */
export class CdekError extends Error {
  readonly code: string;
  readonly cdekErrors: CdekApiError[];
  readonly httpStatus: number | null;

  constructor(
    code: string,
    message: string,
    options: { cdekErrors?: CdekApiError[]; httpStatus?: number | null } = {},
  ) {
    super(message);
    this.name = 'CdekError';
    this.code = code;
    this.cdekErrors = options.cdekErrors ?? [];
    this.httpStatus = options.httpStatus ?? null;
  }
}
