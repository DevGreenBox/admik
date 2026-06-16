/**
 * Санитизация чувствительных полей — единый allow/deny-list (docs/04 §2.4/§7).
 *
 * Вырезает пароли/хеши/токены/секреты из произвольных снимков/контекстов перед
 * записью в журнал аудита или структурный лог. Вынесено в отдельный модуль (а не
 * в audit/log.ts), чтобы переиспользоваться логгером (lib/logger.ts) БЕЗ связности
 * с тяжёлым модулем аудита (audit/log.ts тянет БД) и без поломки при его мокинге
 * в тестах. ADR-015 §6.3: «логгер применяет тот же allow/deny-list, что и аудит».
 */

/**
 * Список чувствительных ключей, которые НИКОГДА не пишутся в журнал/лог.
 * Сравнение — без учёта регистра и по вхождению подстроки (`sessionToken`,
 * `refresh_token`, `API_SECRET`, `authorization` и т.п. тоже отсекаются).
 */
const SENSITIVE_KEYS: readonly string[] = [
  'password',
  'password_hash',
  'passwordhash',
  'token',
  'secret',
  'credentials',
  'apikey',
  'api_key',
  'private_key',
  'privatekey',
  'authorization',
];

/** true, если имя ключа содержит любой из чувствительных маркеров (регистронезависимо). */
export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((marker) => lower.includes(marker));
}

/**
 * Рекурсивно санитизирует произвольное значение (объект/массив/скаляр).
 * Не мутирует вход; вырезает ключи, помеченные isSensitiveKey.
 */
export function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        continue;
      }
      out[key] = sanitizeValue(val);
    }
    return out;
  }
  return value;
}

/**
 * Чистая функция санитизации снимка состояния.
 * Вырезает чувствительные ключи рекурсивно, не мутируя вход.
 * @returns очищенную копию или `null`, если на входе null/undefined.
 */
export function sanitize(
  data?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (data === null || data === undefined) {
    return null;
  }
  return sanitizeValue(data) as Record<string, unknown>;
}
