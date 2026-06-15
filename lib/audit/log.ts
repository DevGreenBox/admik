import type { JSONValue } from 'postgres';
import { sql } from '@/lib/db/client';

/**
 * Единый helper записи в audit_log (§7.2).
 *
 * Принципы (docs/04, §2.4 / §7):
 *   * Append-only: только INSERT (роль admik_app лишена UPDATE/DELETE на audit_log).
 *   * before/after пишутся как jsonb-снимки изменённых полей.
 *   * Санитизация: чувствительные поля (пароли, хеши, токены, секреты) НИКОГДА не
 *     попадают в журнал — вырезаются `sanitize` рекурсивно перед записью.
 *   * Аудит не должен ронять бизнес-операцию: ошибки записи логируются в console.error
 *     и НЕ пробрасываются наружу (мутация уже совершена, журнал — побочный эффект).
 */

export interface AuditEntry {
  /** Семантический код действия, например 'user.update', 'auth.login'. */
  action: string;
  /** Тип затронутой сущности: 'user', 'role', 'order', ... */
  entityType?: string;
  /** Идентификатор затронутой сущности (text — универсально для uuid/bigint). */
  entityId?: string;
  /** Состояние ДО изменения (NULL для create). */
  before?: Record<string, unknown>;
  /** Состояние ПОСЛЕ изменения (NULL для delete). */
  after?: Record<string, unknown>;
}

export interface AuditContext {
  /** Кто инициатор (NULL = система/аноним). */
  actorUserId?: string;
  /** Денормализованный email на момент действия (переживает удаление учётки). */
  actorEmail?: string;
  /** IP инициатора. */
  ip?: string;
  /** User-Agent инициатора. */
  userAgent?: string;
}

/**
 * Список чувствительных ключей, которые НИКОГДА не пишутся в аудит.
 * Сравнение ведётся без учёта регистра и по вхождению подстроки (`sessionToken`,
 * `refresh_token`, `API_SECRET` и т.п. тоже отсекаются).
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
];

/** true, если имя ключа содержит любой из чувствительных маркеров (регистронезависимо). */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((marker) => lower.includes(marker));
}

/** Рекурсивно санитизирует произвольное значение (объект/массив/скаляр). */
function sanitizeValue(value: unknown): unknown {
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
 * Чистая функция санитизации снимка состояния для аудита.
 * Вырезает чувствительные ключи (SENSITIVE_KEYS) рекурсивно, не мутируя вход.
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

/**
 * Записывает событие в audit_log (§7.2). Параметризовано через tagged template `sql`.
 * before/after санитизируются и сериализуются в jsonb.
 *
 * Никогда не бросает наружу: сбой записи аудита логируется, но не прерывает
 * вызывающую бизнес-операцию.
 */
export async function writeAudit(entry: AuditEntry, ctx: AuditContext): Promise<void> {
  try {
    const before = sanitize(entry.before);
    const after = sanitize(entry.after);

    await sql`
      INSERT INTO audit_log
        (actor_user_id, actor_email, action, entity_type, entity_id,
         before_data, after_data, ip, user_agent)
      VALUES (
        ${ctx.actorUserId ?? null},
        ${ctx.actorEmail ?? null},
        ${entry.action},
        ${entry.entityType ?? null},
        ${entry.entityId ?? null},
        ${before === null ? null : sql.json(before as JSONValue)},
        ${after === null ? null : sql.json(after as JSONValue)},
        ${ctx.ip ?? null},
        ${ctx.userAgent ?? null}
      )
    `;
  } catch (error) {
    // Аудит — побочный эффект мутации; его сбой не должен ронять бизнес-операцию.
    console.error('[audit] не удалось записать событие аудита:', error);
  }
}
