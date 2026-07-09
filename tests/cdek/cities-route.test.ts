import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Тесты GET /api/storefront/v1/delivery/cdek/cities (автокомплит города).
 *
 * Happy-path (mock-режим СДЭК) — фикстуры без сети. Плюс обработка CdekError
 * (аудит перехода в бой 2026-07-09, medium): раньше 429/таймаут/HTTP-ошибка
 * СДЭК роняли роут в неструктурированный 500 без JSON-конверта и CORS. Теперь
 * любой CdekError → 503 { error: { code:'service_unavailable', message } } —
 * тот же envelope, что у остальных storefront-ошибок, CORS сохраняется.
 *
 * CityService мокается фабрикой с ДИНАМИЧЕСКИМ импортом реального CdekError:
 * после vi.resetModules() роут и тест обязаны видеть ОДИН класс (instanceof).
 */

const ORIGINAL = { ...process.env };
const KEY = 'sk_secret';

function setEnv() {
  process.env.ADMIK_MODULES = 'catalog,orders,cdek';
  process.env.STOREFRONT_API_KEYS = KEY;
  process.env.STOREFRONT_ALLOWED_ORIGINS = '';
  delete process.env.CDEK_ACCOUNT; // mock-режим СДЭК
  delete process.env.CDEK_SECRET;
}

async function loadCities() {
  vi.resetModules();
  return import('@/app/api/storefront/v1/delivery/cdek/cities/route');
}

function authedGet(url: string) {
  return new Request(url, { headers: { 'x-storefront-key': KEY } });
}

describe('storefront/delivery/cdek/cities — конвейер и обработка CdekError', () => {
  beforeEach(() => setEnv());
  afterEach(() => {
    process.env = { ...ORIGINAL };
    vi.resetModules();
    vi.doUnmock('@/lib/cdek/services/city');
  });

  it('mock-режим: 200 { data: [{ code, name, region }] } + CORS', async () => {
    const { GET } = await loadCities();
    const res = await GET(authedGet('http://x/?q=моск'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ code: number; name: string }> };
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
    expect(typeof json.data[0]!.code).toBe('number');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('без ключа → 401', async () => {
    const { GET } = await loadCities();
    const res = await GET(new Request('http://x/?q=моск'));
    expect(res.status).toBe(401);
  });

  function mockCityServiceThrow(code: string) {
    vi.doMock('@/lib/cdek/services/city', async () => {
      const { CdekError } = await import('@/lib/cdek/errors');
      return {
        CityService: class {
          async searchCities(): Promise<never> {
            throw new CdekError(code, `test ${code}`);
          }
        },
      };
    });
  }

  it("'cdek_rate_limited' (429 СДЭК) → 503 со структурированным конвертом + CORS", async () => {
    mockCityServiceThrow('cdek_rate_limited');
    const { GET } = await loadCities();
    const res = await GET(authedGet('http://x/?q=моск'));
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('service_unavailable');
    expect(json.error.message).toBeTruthy();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it("'cdek_network_error' (таймаут/сеть) → 503 с конвертом, не голый 500", async () => {
    mockCityServiceThrow('cdek_network_error');
    const { GET } = await loadCities();
    const res = await GET(authedGet('http://x/?q=моск'));
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('service_unavailable');
  });

  it("'cdek_http_error' → 503 с конвертом", async () => {
    mockCityServiceThrow('cdek_http_error');
    const { GET } = await loadCities();
    const res = await GET(authedGet('http://x/?q=моск'));
    expect(res.status).toBe(503);
  });
});
