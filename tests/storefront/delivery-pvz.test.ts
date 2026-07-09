import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Тесты GET /api/storefront/v1/delivery/cdek/pvz — боевой режим (аудит
 * 2026-07-09, apidoc.cdek.ru deliverypoints):
 *   • валидация type Zod-enum PVZ|POSTAMAT|ALL (apidoc: enum, default ALL);
 *     мусор → 400 bad_request в конверте { error: { code, message } };
 *   • type=ALL нормализуется в «без фильтра» (СДЭК-семантика default);
 *   • опц. weight (граммы, целое >0) — фильтр габаритов на будущее; мусор → 400;
 *   • CdekError (сеть/5xx/429/400 СДЭК) → 503 в конверте + CORS-заголовки
 *     (раньше пролетал голым 500 без JSON и CORS);
 *   • базовые сценарии mock-режима не сломаны (фикстуры, 400 без города).
 */

const ORIGINAL = {
  modules: process.env.ADMIK_MODULES,
  keys: process.env.STOREFRONT_API_KEYS,
  origins: process.env.STOREFRONT_ALLOWED_ORIGINS,
  account: process.env.CDEK_ACCOUNT,
  secret: process.env.CDEK_SECRET,
};

const KEY = 'sk_secret';

function setMockEnv() {
  process.env.ADMIK_MODULES = 'catalog,orders,cdek';
  process.env.STOREFRONT_API_KEYS = KEY;
  process.env.STOREFRONT_ALLOWED_ORIGINS = '';
  delete process.env.CDEK_ACCOUNT; // mock-режим СДЭК
  delete process.env.CDEK_SECRET;
}

function setRealEnv() {
  setMockEnv();
  process.env.CDEK_ACCOUNT = 'acc-live';
  process.env.CDEK_SECRET = 'sec-live';
}

async function loadPvz() {
  vi.resetModules();
  return import('@/app/api/storefront/v1/delivery/cdek/pvz/route');
}

function authedGet(url: string) {
  return new Request(url, { headers: { 'x-storefront-key': KEY } });
}

describe('storefront GET /delivery/cdek/pvz — валидация и ошибки СДЭК', () => {
  beforeEach(() => setMockEnv());
  afterEach(() => {
    process.env.ADMIK_MODULES = ORIGINAL.modules;
    process.env.STOREFRONT_API_KEYS = ORIGINAL.keys;
    process.env.STOREFRONT_ALLOWED_ORIGINS = ORIGINAL.origins;
    if (ORIGINAL.account === undefined) delete process.env.CDEK_ACCOUNT;
    else process.env.CDEK_ACCOUNT = ORIGINAL.account;
    if (ORIGINAL.secret === undefined) delete process.env.CDEK_SECRET;
    else process.env.CDEK_SECRET = ORIGINAL.secret;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  // --- валидация type (Zod-enum PVZ|POSTAMAT|ALL, apidoc) --------------------

  it('type=PVZ → 200, в mock только офисы типа PVZ', async () => {
    const { GET } = await loadPvz();
    const res = await GET(authedGet('http://x/?city_code=44&type=PVZ'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ type: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((o) => o.type === 'PVZ')).toBe(true);
  });

  it('type=ALL → 200, непустой список (нормализуется в «без фильтра»)', async () => {
    const { GET } = await loadPvz();
    const res = await GET(authedGet('http://x/?city_code=44&type=ALL'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('type=мусор → 400 bad_request в конверте + CORS', async () => {
    const { GET } = await loadPvz();
    const res = await GET(authedGet('http://x/?city_code=44&type=DROP%20TABLE'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('bad_request');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('type=pvz (не тот регистр) → 400 (enum строгий)', async () => {
    const { GET } = await loadPvz();
    const res = await GET(authedGet('http://x/?city_code=44&type=pvz'));
    expect(res.status).toBe(400);
  });

  it('пустой type трактуется как отсутствующий → 200', async () => {
    const { GET } = await loadPvz();
    const res = await GET(authedGet('http://x/?city_code=44&type='));
    expect(res.status).toBe(200);
  });

  // --- валидация weight (граммы, целое > 0) ----------------------------------

  it.each(['abc', '0', '-5', '1.5'])('weight=%s → 400 bad_request', async (w) => {
    const { GET } = await loadPvz();
    const res = await GET(authedGet(`http://x/?city_code=44&weight=${w}`));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('bad_request');
  });

  it('weight=500 (валидный) → 200 (mock игнорирует вес)', async () => {
    const { GET } = await loadPvz();
    const res = await GET(authedGet('http://x/?city_code=44&weight=500'));
    expect(res.status).toBe(200);
  });

  // --- базовые сценарии не сломаны -------------------------------------------

  it('GET без city_code/postal_code → 400', async () => {
    const { GET } = await loadPvz();
    const res = await GET(authedGet('http://x/'));
    expect(res.status).toBe(400);
  });

  it('GET c city_code → 200, DTO без внутренних полей', async () => {
    const { GET } = await loadPvz();
    const res = await GET(authedGet('http://x/?city_code=44'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).not.toHaveProperty('cityCode');
  });

  // --- ошибки СДЭК → 503 в конверте (а не голый 500) --------------------------

  it('CdekError (СДЭК отверг креды) → 503 { error } + CORS + Retry-After', async () => {
    setRealEnv();
    // Реальный режим: первый сетевой вызов — POST /v2/oauth/token; 401 → мгновенный
    // CdekError('cdek_auth_failed') без ретраев (token-cache). Роут обязан отдать
    // структурированный 503, а не пробросить исключение в голый 500 Next.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    const { GET } = await loadPvz();
    const res = await GET(authedGet('http://x/?city_code=44'));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('upstream_unavailable');
    expect(typeof body.error.message).toBe('string');
    // Внутренности (креды/код СДЭК/URL) не утекают на витрину.
    expect(body.error.message).not.toContain('acc-live');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });
});
