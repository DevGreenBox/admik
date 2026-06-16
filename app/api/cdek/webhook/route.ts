import { NextResponse, type NextRequest } from 'next/server';

import { getCdekConfig } from '@/lib/cdek/config';
import { verifyWebhookIp, WebhookService } from '@/lib/cdek/services/webhook';
import { isModuleEnabled } from '@/lib/config/modules';
import { logger } from '@/lib/logger';

/** Структурный логгер webhook СДЭК (наблюдаемость, Этап 6 §6.3). */
const log = logger.child({ module: 'cdek.webhook' });

/**
 * Webhook статусов СДЭК (docs/08 §8).
 *
 * Это server-to-server роут (СДЭК → наш сервер), НЕ storefront: без runStorefront,
 * без CORS. Защита своя:
 *   1) module-gate: модуль cdek выключен → 404;
 *   2) IP-whitelist (CDEK_WEBHOOK_IPS) через verifyWebhookIp; IP берётся из
 *      соединения, за прокси (CDEK_WEBHOOK_TRUST_PROXY=true) — из X-Forwarded-For;
 *      пустой whitelist разрешён только в testMode (bypass с warn);
 *   3) опц. секрет ?key= должен равняться CDEK_WEBHOOK_SECRET (если задан);
 *   4) парсинг тела → handleWebhookEvent (идемпотентно по UNIQUE в cdek_status_log).
 *
 * КЛЮЧЕВОЕ (docs/08 §8.2): на УСПЕШНО прошедшем защиту запросе ВСЕГДА возвращаем
 * 200 — даже на битый JSON, дубликат или ошибку хендлера, чтобы СДЭК не ретраил
 * бесконечно; проблемы логируются. Отказ защиты (IP/секрет) → 403/401.
 *
 * GET — health/верификация подписки СДЭК (отдаёт ok без обработки).
 */

export const dynamic = 'force-dynamic';

/**
 * Извлекает клиентский IP из запроса (docs/08 §8.2). За доверенным прокси
 * (trustProxy) берём первый адрес X-Forwarded-For (client, proxy1, …), иначе
 * X-Real-IP; без trustProxy полагаемся только на эти заголовки как на источник
 * соединения (Next не отдаёт сырой socket-IP в route handler — за прокси Caddy
 * пробрасывает доверенный заголовок, что и конфигурируется флагом).
 */
function extractIp(req: NextRequest, trustProxy: boolean): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (trustProxy && fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  if (fwd) {
    // Нет trustProxy, но другого источника нет — берём первый адрес как best-effort.
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return '';
}

/** GET — проверка доступности эндпоинта (верификация подписки/health). */
export function GET(): NextResponse {
  if (!isModuleEnabled('cdek')) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, service: 'cdek-webhook' });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isModuleEnabled('cdek')) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const cfg = getCdekConfig();

  // (1) IP-whitelist.
  const ip = extractIp(req, cfg.webhookTrustProxy);
  const ipOk = verifyWebhookIp(ip, cfg.webhookAllowedIps, {
    trustProxy: cfg.webhookTrustProxy,
    testMode: cfg.testMode,
  });
  if (!ipOk) {
    log.warn('webhook отклонён: IP вне whitelist', { ip, status: 403 });
    console.warn(`[cdek] webhook отклонён: IP "${ip}" вне whitelist.`);
    return NextResponse.json({ ok: false, error: 'forbidden_ip' }, { status: 403 });
  }

  // (2) Секрет ?key= (если CDEK_WEBHOOK_SECRET задан).
  if (cfg.webhookSecret) {
    const key = req.nextUrl.searchParams.get('key');
    if (key !== cfg.webhookSecret) {
      console.warn('[cdek] webhook отклонён: неверный/отсутствующий ?key.');
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  // (3) Парсинг тела — битый JSON → 200 с warn (СДЭК не должен ретраить вечно).
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    console.warn('[cdek] webhook: тело не является валидным JSON.');
    return NextResponse.json({ ok: false, warn: 'invalid_json' }, { status: 200 });
  }

  // (4) Обработка — любая ошибка хендлера → 200 с warn (логируется).
  try {
    const result = await new WebhookService().handleWebhookEvent(payload);
    return NextResponse.json({
      ok: true,
      processed: result.processed,
      duplicate: result.duplicate,
    });
  } catch (err) {
    log.error('webhook: ошибка обработки события', {
      err: err instanceof Error ? err.message : String(err),
    });
    console.error('[cdek] webhook: ошибка обработки события:', err);
    return NextResponse.json({ ok: false, warn: 'handler_error' }, { status: 200 });
  }
}
