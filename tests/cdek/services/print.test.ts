import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Тесты PrintService (docs/08 §7.3; боевой контракт печати — apidoc.cdek.ru
 * 2026-07-09, выжимка print.md).
 *
 * Асинхронная модель печати СДЭК: POST → 202 {entity.uuid} → опрос GET, где
 * готовность видна в entity.statuses[] (ACCEPTED → PROCESSING → READY | INVALID
 * | REMOVED), а URL PDF лежит в entity.url (НЕ на верхнем уровне ответа —
 * боевой гэп №1 аудита). Скачивание PDF — сырой fetch с Bearer (ссылка живёт
 * 1 час и требует токен — гэп №3: прямой window.open давал 401).
 */

const updateShipmentMock = vi.fn(async () => null);
type ShipmentLookup = { orderId: string; cdekUuid: string; cdekNumber?: string | null } | null;
const getShipmentMock = vi.fn(
  async (): Promise<ShipmentLookup> => ({ orderId: 'ord-1', cdekUuid: 'u-1', cdekNumber: '1012345678' }),
);
vi.mock('@/lib/cdek/repository', () => ({
  getShipmentByOrderId: (...a: unknown[]) => getShipmentMock(...(a as [])),
  updateShipmentByOrderId: (...a: unknown[]) => updateShipmentMock(...(a as [])),
}));

import { PrintService, PRINT_POLL_DELAYS_MS } from '@/lib/cdek/services/print';
import { CdekManager } from '@/lib/cdek/manager';
import { getCdekConfig } from '@/lib/cdek/config';
import { CdekError } from '@/lib/cdek/errors';
import { MOCK_PRINT_URL } from '@/lib/cdek/mock';

const mockCfg = getCdekConfig({ NODE_ENV: 'test' });
const realCfg = getCdekConfig({
  NODE_ENV: 'test',
  CDEK_ACCOUNT: 'acc',
  CDEK_SECRET: 'sec',
  CDEK_BASE_URL: 'https://api.edu.cdek.ru',
});

const tokenCache = { getToken: vi.fn(async () => 'tok'), invalidate: vi.fn(async () => {}) };

const PDF_URL = 'https://api.edu.cdek.ru/v2/print/orders/print-1.pdf';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Готовый ответ GET печати: entity.url + statuses READY (боевой формат). */
function readyEntity(uuid = 'print-1', url = PDF_URL): unknown {
  return {
    entity: {
      uuid,
      url,
      statuses: [
        { code: 'ACCEPTED', date_time: '2026-07-09T10:00:00Z' },
        { code: 'READY', date_time: '2026-07-09T10:00:02Z' },
      ],
    },
  };
}

describe('cdek/print — mock', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getShipmentLabel в mock → фейковый PDF-URL', async () => {
    const svc = new PrintService(new CdekManager({ config: mockCfg }));
    const { url } = await svc.getShipmentLabel('ord-1');
    expect(url).toBe(MOCK_PRINT_URL);
  });

  it('downloadShipmentLabel в mock → CdekError cdek_print_mock (реального PDF нет)', async () => {
    const svc = new PrintService(new CdekManager({ config: mockCfg }));
    await expect(svc.downloadShipmentLabel('ord-1')).rejects.toMatchObject({
      code: 'cdek_print_mock',
    });
  });
});

describe('cdek/print — асинхронная модель (POST → опрос statuses → entity.url)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getShipmentMock.mockResolvedValue({ orderId: 'ord-1', cdekUuid: 'u-1', cdekNumber: '1012345678' });
  });

  function makeService(fetchImpl: typeof fetch, pollDelaysMs: readonly number[] = [0, 0]) {
    return new PrintService(new CdekManager({ config: realCfg, fetchImpl, tokenCache }), {
      pollDelaysMs,
      fetchImpl,
    });
  }

  it('накладная: POST /v2/print/orders → GET со statuses READY → URL из entity.url', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (init?.method === 'POST') return json({ entity: { uuid: 'print-1' } }, 202);
      return json(readyEntity());
    }) as unknown as typeof fetch;

    const { url } = await makeService(fetchImpl).getShipmentLabel('ord-1', { kind: 'waybill' });
    expect(url).toBe(PDF_URL);
    expect(calls[0]).toContain('POST');
    expect(calls[0]).toContain('/v2/print/orders');
    expect(calls[1]).toContain('GET');
    expect(calls[1]).toContain('/v2/print/orders/print-1');
    expect(updateShipmentMock).toHaveBeenCalledWith('ord-1', { printUrl: PDF_URL });
  });

  it('БОЕВОЙ ГЭП №1: url на ВЕРХНЕМ уровне ответа (без entity.url) НЕ считается готовностью', async () => {
    // Старый код читал top-level url — в боевом API его там нет. Проверяем, что
    // «мусорный» top-level url не принимается за готовый PDF.
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ entity: { uuid: 'print-1' } }, 202);
      return json({ url: 'https://evil.example/top-level.pdf', entity: { uuid: 'print-1', statuses: [{ code: 'PROCESSING' }] } });
    }) as unknown as typeof fetch;

    await expect(
      makeService(fetchImpl, [0]).getShipmentLabel('ord-1'),
    ).rejects.toMatchObject({ code: 'cdek_print_not_ready' });
  });

  it('опрос переиспользует ОДИН printUuid: PROCESSING → READY (без нового POST)', async () => {
    let posts = 0;
    let gets = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        return json({ entity: { uuid: 'print-1' } }, 202);
      }
      gets += 1;
      expect(String(url)).toContain('/v2/print/orders/print-1');
      if (gets === 1) return json({ entity: { uuid: 'print-1', statuses: [{ code: 'PROCESSING' }] } });
      return json(readyEntity());
    }) as unknown as typeof fetch;

    const { url } = await makeService(fetchImpl).getShipmentLabel('ord-1');
    expect(url).toBe(PDF_URL);
    expect(posts).toBe(1);
    expect(gets).toBe(2);
  });

  it('INVALID → CdekError cdek_print_invalid с деталями из errors[]', async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ entity: { uuid: 'print-1' } }, 202);
      return json({
        entity: { uuid: 'print-1', statuses: [{ code: 'INVALID' }] },
        requests: [{ state: 'INVALID', errors: [{ code: 'orders_number_is_empty', message: 'нет заказов' }] }],
      });
    }) as unknown as typeof fetch;

    const err = await makeService(fetchImpl).getShipmentLabel('ord-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CdekError);
    expect((err as CdekError).code).toBe('cdek_print_invalid');
    expect((err as CdekError).message).toContain('orders_number_is_empty');
  });

  it('REMOVED (ссылка протухла) → CdekError cdek_print_removed', async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ entity: { uuid: 'print-1' } }, 202);
      return json({ entity: { uuid: 'print-1', statuses: [{ code: 'REMOVED' }] } });
    }) as unknown as typeof fetch;

    await expect(makeService(fetchImpl).getShipmentLabel('ord-1')).rejects.toMatchObject({
      code: 'cdek_print_removed',
    });
  });

  it('не готов после всех попыток → cdek_print_not_ready (попыток = задержек + 1)', async () => {
    let gets = 0;
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ entity: { uuid: 'print-1' } }, 202);
      gets += 1;
      return json({ entity: { uuid: 'print-1', statuses: [{ code: 'PROCESSING' }] } });
    }) as unknown as typeof fetch;

    await expect(
      makeService(fetchImpl, [0, 0, 0]).getShipmentLabel('ord-1'),
    ).rejects.toMatchObject({ code: 'cdek_print_not_ready' });
    expect(gets).toBe(4); // 3 задержки → 4 GET-попытки
  });

  it('дефолтные паузы опроса нарастают и укладываются в ~15 секунд суммарно', () => {
    const total = PRINT_POLL_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(15_000);
    expect(total).toBeGreaterThanOrEqual(10_000);
    for (let i = 1; i < PRINT_POLL_DELAYS_MS.length; i++) {
      expect(PRINT_POLL_DELAYS_MS[i]!).toBeGreaterThanOrEqual(PRINT_POLL_DELAYS_MS[i - 1]!);
    }
    expect(PRINT_POLL_DELAYS_MS[0]).toBeLessThanOrEqual(500);
  });

  it('ШК: POST /v2/print/barcodes с format', async () => {
    let postBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        expect(String(url)).toContain('/v2/print/barcodes');
        postBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return json({ entity: { uuid: 'print-bc' } }, 202);
      }
      return json(readyEntity('print-bc'));
    }) as unknown as typeof fetch;

    const { url } = await makeService(fetchImpl).getShipmentLabel('ord-1', { kind: 'barcode', format: 'A6' });
    expect(url).toBe(PDF_URL);
    expect(postBody).toMatchObject({ format: 'A6', orders: [{ order_uuid: 'u-1' }] });
  });

  it('нет отправления → cdek_no_shipment', async () => {
    getShipmentMock.mockResolvedValue(null);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(makeService(fetchImpl).getShipmentLabel('ord-1')).rejects.toMatchObject({
      code: 'cdek_no_shipment',
    });
  });

  it('POST без entity.uuid → cdek_print_no_uuid с деталями requests[].errors', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ requests: [{ state: 'INVALID', errors: [{ code: 'v2_entity_not_ready', message: 'ещё нет номера' }] }] }, 202),
    ) as unknown as typeof fetch;
    const err = await makeService(fetchImpl).getShipmentLabel('ord-1').catch((e: unknown) => e);
    expect((err as CdekError).code).toBe('cdek_print_no_uuid');
    expect((err as CdekError).message).toContain('v2_entity_not_ready');
  });
});

describe('cdek/print — downloadShipmentLabel (серверная выкачка PDF, гэп №3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getShipmentMock.mockResolvedValue({ orderId: 'ord-1', cdekUuid: 'u-1', cdekNumber: '1012345678' });
    tokenCache.getToken.mockResolvedValue('tok');
  });

  const PDF_BYTES = new TextEncoder().encode('%PDF-1.4 fake');

  function apiThenPdf(opts: { pdfStatus?: number; pdfBody?: BodyInit; pdfType?: string } = {}) {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const headers = new Headers(init?.headers);
      seen.push({ url: u, auth: headers.get('authorization') });
      if (init?.method === 'POST') return json({ entity: { uuid: 'print-1' } }, 202);
      if (u.endsWith('.pdf')) {
        return new Response(opts.pdfBody ?? PDF_BYTES, {
          status: opts.pdfStatus ?? 200,
          headers: { 'content-type': opts.pdfType ?? 'application/pdf' },
        });
      }
      return json(readyEntity());
    }) as unknown as typeof fetch;
    return { fetchImpl, seen };
  }

  it('готовит форму, качает entity.url с Bearer-токеном и отдаёт байты PDF', async () => {
    const { fetchImpl, seen } = apiThenPdf();
    const svc = new PrintService(new CdekManager({ config: realCfg, fetchImpl, tokenCache }), {
      pollDelaysMs: [0],
      fetchImpl,
    });
    const { pdf, fileName } = await svc.downloadShipmentLabel('ord-1', { kind: 'waybill' });
    expect(new TextDecoder().decode(pdf)).toContain('%PDF');
    expect(fileName).toBe('cdek-waybill-1012345678.pdf');
    const pdfCall = seen.find((c) => c.url.endsWith('.pdf'));
    expect(pdfCall).toBeDefined();
    expect(pdfCall!.auth).toBe('Bearer tok');
    // print_url сохранён в shipment (карточка/раздел показывают актуальность).
    expect(updateShipmentMock).toHaveBeenCalledWith('ord-1', { printUrl: PDF_URL });
  });

  it('PDF-эндпоинт вернул 401 → invalidate токена + ровно один повтор со свежим', async () => {
    let pdfCalls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST') return json({ entity: { uuid: 'print-1' } }, 202);
      if (u.endsWith('.pdf')) {
        pdfCalls += 1;
        if (pdfCalls === 1) return new Response('', { status: 401 });
        return new Response(PDF_BYTES, { status: 200, headers: { 'content-type': 'application/pdf' } });
      }
      return json(readyEntity());
    }) as unknown as typeof fetch;

    const svc = new PrintService(new CdekManager({ config: realCfg, fetchImpl, tokenCache }), {
      pollDelaysMs: [0],
      fetchImpl,
    });
    const { pdf } = await svc.downloadShipmentLabel('ord-1');
    expect(new TextDecoder().decode(pdf)).toContain('%PDF');
    expect(pdfCalls).toBe(2);
    expect(tokenCache.invalidate).toHaveBeenCalledOnce();
  });

  it('PDF-эндпоинт вернул не-PDF (JSON ошибки) → cdek_print_download_failed с деталями', async () => {
    const { fetchImpl } = apiThenPdf({
      pdfStatus: 400,
      pdfBody: JSON.stringify({ errors: [{ code: 'v2_entity_invalid', message: 'плохой uuid' }] }),
      pdfType: 'application/json',
    });
    const svc = new PrintService(new CdekManager({ config: realCfg, fetchImpl, tokenCache }), {
      pollDelaysMs: [0],
      fetchImpl,
    });
    const err = await svc.downloadShipmentLabel('ord-1').catch((e: unknown) => e);
    expect((err as CdekError).code).toBe('cdek_print_download_failed');
    expect((err as CdekError).message).toContain('v2_entity_invalid');
  });
});
