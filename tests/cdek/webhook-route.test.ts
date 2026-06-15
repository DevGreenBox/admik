import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Интеграционные тесты webhook-роута СДЭК (docs/08 §8, Пакет F).
 *
 * Без живой БД/сети: WebhookService.handleWebhookEvent мокается, проверяется
 * связка route-слоя:
 *   • IP-whitelist (verifyWebhookIp): чужой IP → 403 без обработки; валидный → 200;
 *   • секрет ?key= (если CDEK_WEBHOOK_SECRET задан): неверный → 401;
 *   • парсинг: битый JSON → 200 warn=invalid_json (СДЭК не должен ретраить вечно);
 *   • дубликат (handler → duplicate:true) → 200;
 *   • ошибка хендлера → 200 warn=handler_error;
 *   • module-gate: cdek выключен → 404.
 *
 * IP в роуте берётся из X-Forwarded-For (trustProxy) / X-Real-IP — задаём заголовки.
 */

const handleWebhookEventMock = vi.fn(
  async (_payload: unknown): Promise<{ processed: boolean; duplicate: boolean }> => ({
    processed: true,
    duplicate: false,
  }),
);

vi.mock('@/lib/cdek/services/webhook', async (importOriginal) => {
  // verifyWebhookIp/parseEvent — настоящие (чистые); подменяем только класс сервиса.
  const actual = await importOriginal<typeof import('@/lib/cdek/services/webhook')>();
  return {
    ...actual,
    WebhookService: class {
      handleWebhookEvent(payload: unknown) {
        return handleWebhookEventMock(payload);
      }
    },
  };
});

const ORIG = { ...process.env };

interface PostInit {
  body?: BodyInit;
  headers?: Record<string, string>;
}

async function callPost(url: string, init: PostInit = {}) {
  const { POST } = await import('@/app/api/cdek/webhook/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest(new URL(url), {
    method: 'POST',
    body: init.body,
    headers: init.headers,
  });
  return POST(req);
}

beforeEach(() => {
  vi.resetModules();
  handleWebhookEventMock.mockClear();
  handleWebhookEventMock.mockResolvedValue({ processed: true, duplicate: false });
  process.env = { ...ORIG };
  // Боевой контур (testMode=false) с whitelist — чтобы IP-проверка была активной.
  delete process.env.CDEK_TEST_MODE;
  process.env.CDEK_WEBHOOK_IPS = '203.0.113.0/24';
  delete process.env.CDEK_WEBHOOK_SECRET;
});

const VALID_IP = '203.0.113.10';
const FOREIGN_IP = '198.51.100.7';

function body(): PostInit {
  return {
    body: JSON.stringify({
      type: 'ORDER_STATUS',
      uuid: 'u-1',
      attributes: { number: 'TC-1', code: 'DELIVERED', status_date_time: '2026-06-15T10:00:00Z' },
    }),
    headers: { 'content-type': 'application/json' },
  };
}

describe('POST /api/cdek/webhook — IP-whitelist', () => {
  it('чужой IP → 403, событие НЕ обрабатывается', async () => {
    const res = await callPost('http://localhost/api/cdek/webhook', {
      ...body(),
      headers: { ...(body().headers as Record<string, string>), 'x-real-ip': FOREIGN_IP },
    });
    expect(res.status).toBe(403);
    expect(handleWebhookEventMock).not.toHaveBeenCalled();
  });

  it('валидный IP (whitelist CIDR) → 200, событие обработано', async () => {
    const res = await callPost('http://localhost/api/cdek/webhook', {
      ...body(),
      headers: { ...(body().headers as Record<string, string>), 'x-real-ip': VALID_IP },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; processed: boolean };
    expect(json.ok).toBe(true);
    expect(handleWebhookEventMock).toHaveBeenCalledOnce();
  });
});

describe('POST /api/cdek/webhook — секрет ?key=', () => {
  it('секрет задан, ключ неверный → 401 без обработки', async () => {
    process.env.CDEK_WEBHOOK_SECRET = 's3cr3t';
    const res = await callPost('http://localhost/api/cdek/webhook?key=wrong', {
      ...body(),
      headers: { ...(body().headers as Record<string, string>), 'x-real-ip': VALID_IP },
    });
    expect(res.status).toBe(401);
    expect(handleWebhookEventMock).not.toHaveBeenCalled();
  });

  it('секрет задан, ключ верный → 200', async () => {
    process.env.CDEK_WEBHOOK_SECRET = 's3cr3t';
    const res = await callPost('http://localhost/api/cdek/webhook?key=s3cr3t', {
      ...body(),
      headers: { ...(body().headers as Record<string, string>), 'x-real-ip': VALID_IP },
    });
    expect(res.status).toBe(200);
    expect(handleWebhookEventMock).toHaveBeenCalledOnce();
  });
});

describe('POST /api/cdek/webhook — парсинг и идемпотентность', () => {
  it('битый JSON → 200 warn=invalid_json (без ретраев СДЭК)', async () => {
    const res = await callPost('http://localhost/api/cdek/webhook', {
      body: '{ not json',
      headers: { 'content-type': 'application/json', 'x-real-ip': VALID_IP },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; warn?: string };
    expect(json.ok).toBe(false);
    expect(json.warn).toBe('invalid_json');
    expect(handleWebhookEventMock).not.toHaveBeenCalled();
  });

  it('дубликат (handler → duplicate:true) → всё равно 200', async () => {
    handleWebhookEventMock.mockResolvedValueOnce({ processed: false, duplicate: true });
    const res = await callPost('http://localhost/api/cdek/webhook', {
      ...body(),
      headers: { ...(body().headers as Record<string, string>), 'x-real-ip': VALID_IP },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; duplicate: boolean };
    expect(json.ok).toBe(true);
    expect(json.duplicate).toBe(true);
  });

  it('ошибка хендлера → 200 warn=handler_error', async () => {
    handleWebhookEventMock.mockRejectedValueOnce(new Error('boom'));
    const res = await callPost('http://localhost/api/cdek/webhook', {
      ...body(),
      headers: { ...(body().headers as Record<string, string>), 'x-real-ip': VALID_IP },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; warn?: string };
    expect(json.ok).toBe(false);
    expect(json.warn).toBe('handler_error');
  });
});

describe('POST /api/cdek/webhook — module-gate и testMode', () => {
  it('модуль cdek выключен → 404', async () => {
    process.env.ADMIK_MODULES = 'catalog,orders';
    const res = await callPost('http://localhost/api/cdek/webhook', {
      ...body(),
      headers: { ...(body().headers as Record<string, string>), 'x-real-ip': VALID_IP },
    });
    expect(res.status).toBe(404);
    expect(handleWebhookEventMock).not.toHaveBeenCalled();
  });

  it('пустой whitelist + testMode=true → bypass, 200', async () => {
    delete process.env.CDEK_WEBHOOK_IPS;
    process.env.CDEK_TEST_MODE = 'true';
    const res = await callPost('http://localhost/api/cdek/webhook', {
      ...body(),
      headers: { ...(body().headers as Record<string, string>), 'x-real-ip': FOREIGN_IP },
    });
    expect(res.status).toBe(200);
    expect(handleWebhookEventMock).toHaveBeenCalledOnce();
  });
});
