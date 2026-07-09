import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { AuthUser } from '@/lib/auth/rbac';

/**
 * Тесты GET /admin/cdek/label — авторизованный серверный PDF-прокси печати
 * СДЭК (гэп №3 боевого аудита 2026-07-09: прямой линк api.cdek.ru требует
 * Bearer и живёт ~1 час → 401 в браузере админа).
 *
 * Паттерн мутационного пайплайна соблюдён на route-слое: guard (guardCdek,
 * cdek.manage) → Zod (query) → работа (PrintService.downloadShipmentLabel) →
 * audit (cdek.print.label). Кеш не инвалидируется (выдача файла).
 */

const guardMock = vi.fn(
  async (): Promise<
    | { ok: true; user: AuthUser }
    | { ok: false; reason: 'module_disabled' }
    | { ok: false; reason: 'forbidden'; permission: string }
  > => ({ ok: true, user: { id: 'user-1', email: 'admin@admik.test' } as unknown as AuthUser }),
);
vi.mock('@/app/admin/(panel)/cdek/_components/guard', () => ({
  guardCdek: (...a: unknown[]) => guardMock(...(a as [])),
}));

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4 fake');
const downloadMock = vi.fn(async () => ({
  pdf: PDF_BYTES,
  fileName: 'cdek-waybill-1012345678.pdf',
  url: 'https://api.cdek.ru/v2/print/orders/print-1.pdf',
}));
vi.mock('@/lib/cdek/services/print', () => ({
  PrintService: class {
    downloadShipmentLabel = downloadMock;
  },
}));

const writeAuditMock = vi.fn(async () => undefined);
vi.mock('@/lib/audit/log', () => ({
  writeAudit: (...a: unknown[]) => writeAuditMock(...(a as [])),
}));

import { GET } from '@/app/admin/(panel)/cdek/label/route';
import { NextRequest } from 'next/server';
import { CdekError } from '@/lib/cdek/errors';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function makeReq(query: string): NextRequest {
  return new NextRequest(new URL(`http://localhost/admin/cdek/label${query}`), { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  guardMock.mockResolvedValue({
    ok: true,
    user: { id: 'user-1', email: 'admin@admik.test' } as unknown as AuthUser,
  });
  downloadMock.mockResolvedValue({
    pdf: PDF_BYTES,
    fileName: 'cdek-waybill-1012345678.pdf',
    url: 'https://api.cdek.ru/v2/print/orders/print-1.pdf',
  });
});

describe('GET /admin/cdek/label — guard', () => {
  it('модуль cdek выключен → 404, печать не вызывается', async () => {
    guardMock.mockResolvedValue({ ok: false, reason: 'module_disabled' });
    const res = await GET(makeReq(`?orderId=${ORDER_ID}`));
    expect(res.status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('нет права cdek.manage → 403', async () => {
    guardMock.mockResolvedValue({ ok: false, reason: 'forbidden', permission: 'cdek.manage' });
    const res = await GET(makeReq(`?orderId=${ORDER_ID}`));
    expect(res.status).toBe(403);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('guard запрашивается с правом cdek.manage', async () => {
    await GET(makeReq(`?orderId=${ORDER_ID}`));
    expect(guardMock).toHaveBeenCalledWith('cdek.manage');
  });
});

describe('GET /admin/cdek/label — Zod-валидация query', () => {
  it('orderId не UUID → 400', async () => {
    const res = await GET(makeReq('?orderId=not-a-uuid'));
    expect(res.status).toBe(400);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('kind вне enum → 400', async () => {
    const res = await GET(makeReq(`?orderId=${ORDER_ID}&kind=hack`));
    expect(res.status).toBe(400);
  });

  it('kind по умолчанию waybill', async () => {
    await GET(makeReq(`?orderId=${ORDER_ID}`));
    expect(downloadMock).toHaveBeenCalledWith(ORDER_ID, { kind: 'waybill' });
  });
});

describe('GET /admin/cdek/label — выдача PDF + audit', () => {
  it('успех → 200 application/pdf с байтами и inline-filename; audit написан', async () => {
    const res = await GET(makeReq(`?orderId=${ORDER_ID}&kind=barcode`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('inline');
    expect(res.headers.get('content-disposition')).toContain('cdek-waybill-1012345678.pdf');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(body)).toContain('%PDF');
    expect(downloadMock).toHaveBeenCalledWith(ORDER_ID, { kind: 'barcode' });
    expect(writeAuditMock).toHaveBeenCalledOnce();
    const [entry, ctx] = writeAuditMock.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(entry.action).toBe('cdek.print.label');
    expect(entry.entityId).toBe(ORDER_ID);
    expect(ctx.actorUserId).toBe('user-1');
  });

  it('PDF не кешируется (Cache-Control: no-store — ссылка/файл одноразовые)', async () => {
    const res = await GET(makeReq(`?orderId=${ORDER_ID}`));
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});

describe('GET /admin/cdek/label — доменные ошибки CdekError → понятный статус/текст', () => {
  it('mock-режим (cdek_print_mock) → 400 с пояснением', async () => {
    downloadMock.mockRejectedValue(new CdekError('cdek_print_mock', 'MOCK-режим: PDF недоступен.'));
    const res = await GET(makeReq(`?orderId=${ORDER_ID}`));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe('cdek_print_mock');
    expect(json.message).toContain('MOCK');
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it('нет отправления (cdek_no_shipment) → 404', async () => {
    downloadMock.mockRejectedValue(new CdekError('cdek_no_shipment', 'нет отправления'));
    const res = await GET(makeReq(`?orderId=${ORDER_ID}`));
    expect(res.status).toBe(404);
  });

  it('PDF не готов (cdek_print_not_ready) → 502 с message', async () => {
    downloadMock.mockRejectedValue(new CdekError('cdek_print_not_ready', 'повторите позже'));
    const res = await GET(makeReq(`?orderId=${ORDER_ID}`));
    expect(res.status).toBe(502);
    const json = (await res.json()) as { message: string };
    expect(json.message).toContain('повторите');
  });

  it('неожиданная ошибка → 500 без деталей наружу', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    downloadMock.mockRejectedValue(new Error('secret internals'));
    const res = await GET(makeReq(`?orderId=${ORDER_ID}`));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string; message?: string };
    expect(json.error).toBe('internal');
    expect(JSON.stringify(json)).not.toContain('secret internals');
    errSpy.mockRestore();
  });
});
