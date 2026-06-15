/**
 * WebhookService — приём push-событий статусов СДЭК (docs/08 §8, порт carre
 * WebhookService.php + CdekController::actionWebhook).
 *
 * КЛЮЧЕВОЕ — идемпотентность (docs/08 §8.3): событие пишется в cdek_status_log
 * через insertStatusLog (ON CONFLICT DO NOTHING по UNIQUE (cdek_uuid,
 * status_code, status_date_time)); при дубликате (inserted=false) обработка не
 * повторяется. Повторная доставка вебхука всегда безопасна.
 *
 * Чистые тестируемые функции (без сети/БД, всегда зелёные):
 *   • verifyWebhookIp — IP-whitelist (точные IP + CIDR), trust-proxy, mock-bypass;
 *   • parseEvent      — нормализация payload СДЭК в CdekEvent.
 * БД-зависимый handleWebhookEvent — интеграционно (skipIf) либо с моком
 * repository.insertStatusLog в юнит-тесте.
 */

import type { CdekManager } from '../manager';
import { getCdekManager } from '../manager';
import {
  getShipmentByCdekUuid,
  insertStatusLog,
  markStatusLogProcessed,
} from '../repository';
import { getOrderByNumber } from '@/lib/orders/repository';
import { mapCdekStatus, displayName } from './status-map';
import { applyDeliveryStatus } from './delivery-status';

// =============================================================================
// verifyWebhookIp — ЧИСТАЯ. IP-whitelist (точные IPv4 + CIDR). docs/08 §8.2.
// =============================================================================

/** IPv4 «1.2.3.4» → 32-битное число; null при невалидном. */
function ipv4ToLong(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    acc = acc * 256 + n;
  }
  return acc >>> 0;
}

/** Проверяет вхождение IPv4 в CIDR «1.2.3.0/24» (или точный IP без маски). */
function ipInCidr(ip: string, cidr: string): boolean {
  const [net, bitsRaw] = cidr.split('/');
  const ipLong = ipv4ToLong(ip);
  const netLong = ipv4ToLong(net!);
  if (ipLong === null || netLong === null) return false;
  if (bitsRaw === undefined) {
    return ipLong === netLong; // точный IP
  }
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (ipLong & mask) === (netLong & mask);
}

export interface VerifyIpOptions {
  /** Доверять прокси-заголовку (за Caddy). Влияет только на выбор источника IP — вызывающий уже извлёк ip. */
  trustProxy?: boolean;
  /** mock/test-режим: пустой whitelist разрешён (bypass с warn). */
  testMode?: boolean;
}

/**
 * Проверяет, разрешён ли IP по whitelist (docs/08 §8.2, порт checkIp):
 *   • whitelist непустой → IP должен входить хотя бы в один диапазон (иначе false);
 *   • whitelist пустой → разрешено ТОЛЬКО в testMode (bypass с warn), иначе false.
 * Чистая, детерминированная. trustProxy здесь не меняет результат (источник IP
 * выбирает route-слой) — принимается для совместимости контракта.
 */
export function verifyWebhookIp(
  ip: string,
  whitelist: readonly string[],
  opts: VerifyIpOptions = {},
): boolean {
  if (!whitelist || whitelist.length === 0) {
    if (opts.testMode) {
      console.warn('[cdek] webhook IP-whitelist пуст — bypass разрешён только в test-режиме.');
      return true;
    }
    return false;
  }
  return whitelist.some((cidr) => ipInCidr(ip, cidr));
}

// =============================================================================
// parseEvent — ЧИСТАЯ. Нормализация payload СДЭК → CdekEvent. docs/08 §8.3.
// =============================================================================

/** Нормализованное событие webhook (порт parseEvent). */
export interface CdekEvent {
  type: string | null;
  /** UUID отправления в СДЭК. */
  cdekUuid: string | null;
  /** Наш номер заказа (attributes.number) — приоритетный ключ поиска. */
  orderNumber: string | null;
  /** Трек-номер СДЭК (attributes.cdek_number). */
  cdekNumber: string | null;
  statusCode: string | null;
  statusName: string | null;
  statusDateTime: Date | null;
  cityCode: number | null;
  cityName: string | null;
  raw: Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function int(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function dt(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Нормализует входной payload вебхука СДЭК в CdekEvent (чистая). Толерантна к
 * форме: читает top-level type/uuid + attributes.* (number/cdek_number/code/
 * status_code/status_date_time/city_*). Невалидный объект → событие с null-полями
 * (вызывающий отфильтрует по отсутствию cdekUuid/statusCode).
 */
export function parseEvent(payload: unknown): CdekEvent {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const attrs = (p.attributes && typeof p.attributes === 'object'
    ? p.attributes
    : {}) as Record<string, unknown>;

  const code = str(attrs.code) ?? str(attrs.status_code);
  return {
    type: str(p.type),
    cdekUuid: str(p.uuid) ?? str(attrs.cdek_uuid) ?? str(attrs.order_uuid),
    orderNumber: str(attrs.number),
    cdekNumber: str(attrs.cdek_number),
    statusCode: code,
    statusName: str(attrs.status_name) ?? (code ? displayName(code) : null),
    statusDateTime: dt(attrs.status_date_time),
    cityCode: int(attrs.city_code),
    cityName: str(attrs.city_name),
    raw: p,
  };
}

// =============================================================================
// handleWebhookEvent — обработка с идемпотентностью (БД).
// =============================================================================

export interface HandleResult {
  processed: boolean;
  duplicate: boolean;
}

export class WebhookService {
  constructor(private readonly manager: CdekManager = getCdekManager()) {}

  /**
   * Обрабатывает событие вебхука с идемпотентностью (docs/08 §8.3):
   *   1) parseEvent → нормализация;
   *   2) поиск заказа по orderNumber → по cdek_uuid (через shipment); не найден → no-op;
   *   3) insertStatusLog (ON CONFLICT DO NOTHING); дубликат → {duplicate:true} без обработки;
   *   4) маппинг статуса + переход delivery_status (canTransition) — недопустимый молча пропускается;
   *   5) markStatusLogProcessed.
   * Всегда безопасно при повторной доставке (никаких двойных переходов/эффектов).
   */
  async handleWebhookEvent(payload: unknown): Promise<HandleResult> {
    const event = parseEvent(payload);

    if (!event.cdekUuid || !event.statusCode) {
      return { processed: false, duplicate: false };
    }

    // 1) Поиск заказа (orderNumber приоритетнее, затем по shipment.cdek_uuid).
    let orderId: string | null = null;
    if (event.orderNumber) {
      const o = await getOrderByNumber(event.orderNumber);
      orderId = o?.order.id ?? null;
    }
    if (!orderId) {
      const sh = await getShipmentByCdekUuid(event.cdekUuid);
      orderId = sh?.orderId ?? null;
    }
    if (!orderId) {
      console.warn(
        `[cdek] webhook: заказ не найден (number=${event.orderNumber}, uuid=${event.cdekUuid}).`,
      );
      return { processed: false, duplicate: false };
    }

    // 2) Идемпотентная запись в лог.
    const logResult = await insertStatusLog({
      orderId,
      cdekUuid: event.cdekUuid,
      statusCode: event.statusCode,
      statusName: event.statusName,
      statusDateTime: event.statusDateTime,
      cityCode: event.cityCode,
      cityName: event.cityName,
      isMock: this.manager.isMock,
      rawPayload: event.raw,
    });

    if (!logResult.inserted) {
      // Дубликат: событие уже обработано — НЕ повторяем эффекты.
      return { processed: false, duplicate: true };
    }

    // 3) Маппинг + переход delivery_status (недопустимый пропускается молча).
    const next = mapCdekStatus(event.statusCode);
    if (next) {
      await applyDeliveryStatus(orderId, next, `cdek-webhook:${event.statusCode}`);
    }

    // 4) Пометить лог обработанным.
    if (logResult.entry) {
      await markStatusLogProcessed(logResult.entry.id);
    }

    return { processed: true, duplicate: false };
  }
}
