import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { PrintService } from '@/lib/cdek/services/print';
import { CdekError } from '@/lib/cdek/errors';
import { writeAudit } from '@/lib/audit/log';
import { normalizeClientIp } from '@/lib/server/request-ip';
import { logger } from '@/lib/logger';

import { guardCdek } from '../_components/guard';

/** Структурный логгер прокси печати (наблюдаемость, §6.3). */
const log = logger.child({ module: 'cdek.label' });

/**
 * GET /admin/cdek/label — авторизованный серверный PDF-прокси печати СДЭК
 * (боевой гэп №3 аудита 2026-07-09).
 *
 * Прямой URL печати СДЭК (api.cdek.ru/v2/print/...pdf) требует Bearer-токен и
 * живёт ~1 час — открытие его в браузере админа давало 401. Этот route
 * выкачивает PDF на сервере (PrintService.downloadShipmentLabel: POST задачи →
 * опрос statuses до READY → сырой fetch entity.url с токеном) и отдаёт файл.
 *
 * Пайплайн (эквивалент паттерна мутаций для route-слоя):
 *   1) guard   — guardCdek('cdek.manage'): модуль включён + аутентификация
 *      (requireUser → redirect на /admin/login) + право;
 *   2) Zod     — валидация query (orderId uuid, kind enum);
 *   3) работа  — печать/скачивание (запись print_url внутри сервиса);
 *   4) audit   — cdek.print.label с actor/ip/ua.
 * Кеш не инвалидируется — выдача файла (карточку заказа обновляет пользователь).
 *
 * Ошибки CdekError отдаются понятным JSON (код + безопасное сообщение);
 * неожиданные → 500 без деталей (детали в лог сервера).
 */

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  orderId: z.string().uuid(),
  kind: z.enum(['waybill', 'barcode']).default('waybill'),
});

/** HTTP-статус для доменных ошибок печати (безопасные сообщения CdekError). */
function cdekErrorStatus(code: string): number {
  switch (code) {
    case 'cdek_print_mock':
      return 400; // UI в mock сюда не ходит; прямой заход — понятное пояснение
    case 'cdek_no_shipment':
      return 404;
    default:
      return 502; // не готов/INVALID/REMOVED/скачивание — проблема на стороне СДЭК
  }
}

export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  // (1) Guard: модуль + аутентификация (redirect на login) + право cdek.manage.
  const guard = await guardCdek('cdek.manage');
  if (!guard.ok) {
    if (guard.reason === 'module_disabled') {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  // (2) Zod-валидация query.
  const parsed = QuerySchema.safeParse({
    orderId: req.nextUrl.searchParams.get('orderId') ?? undefined,
    kind: req.nextUrl.searchParams.get('kind') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'validation' }, { status: 400 });
  }
  const { orderId, kind } = parsed.data;

  // (3) Печать + выкачка PDF на сервере.
  try {
    const { pdf, fileName } = await new PrintService().downloadShipmentLabel(orderId, { kind });

    // (4) Audit — как у Server Action getCdekLabel (тот же action-код).
    await writeAudit(
      {
        action: 'cdek.print.label',
        entityType: 'cdek_shipment',
        entityId: orderId,
        after: { kind, fileName },
      },
      {
        actorUserId: guard.user.id,
        actorEmail: guard.user.email,
        ip:
          normalizeClientIp(
            req.headers.get('x-forwarded-for'),
            req.headers.get('x-real-ip'),
          ) ?? undefined,
        userAgent: req.headers.get('user-agent') ?? undefined,
      },
    );

    // Свежий ArrayBuffer-срез: Uint8Array<ArrayBufferLike> не входит в BodyInit
    // по типам DOM lib (SharedArrayBuffer-ветка generic), ArrayBuffer — входит.
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        // Ссылка СДЭК живёт ~1 час, файл персонален — не кешировать.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof CdekError) {
      // Доменные сообщения печати безопасны для оператора (без секретов).
      log.warn('печать: доменная ошибка', { code: err.code, orderId });
      return NextResponse.json(
        { ok: false, error: err.code, message: err.message },
        { status: cdekErrorStatus(err.code) },
      );
    }
    log.error('печать: неожиданная ошибка', {
      err: err instanceof Error ? err.message : String(err),
      orderId,
    });
    console.error('[cdek] label proxy: неожиданная ошибка:', err);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
