import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Тесты enforcement allowedTariffs в storefront-расчёте СДЭК
 * (POST /api/storefront/v1/delivery/cdek/calculate, finding #4).
 *
 * СДЭК в mock-режиме (пустые CDEK_ACCOUNT/CDEK_SECRET): расчёт по формуле §5.3,
 * mockCalculateByTariff эхо-отдаёт переданный tariffCode → можно проверить, какой
 * тариф фактически ушёл в Calculator.
 *
 * Правило: если CDEK_ALLOWED_TARIFFS непуст и входной tariffCode НЕ в белом
 * списке — роут НЕ доверяет клиентскому коду, а подставляет defaultTariffCode
 * (CDEK_DEFAULT_TARIFF). Разрешённый код проходит как есть. Пустой allowedTariffs
 * = разрешены любые (обратная совместимость).
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

async function loadCalc() {
  vi.resetModules();
  return import('@/app/api/storefront/v1/delivery/cdek/calculate/route');
}

function authedPost(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'x-storefront-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function calc(body: unknown): Promise<{ status: number; data?: { tariffCode: number } }> {
  const { POST } = await loadCalc();
  const res = await POST(authedPost('http://x/', body));
  if (res.status !== 200) return { status: res.status };
  const json = (await res.json()) as { data: { tariffCode: number } };
  return { status: res.status, data: json.data };
}

describe('storefront/delivery/cdek/calculate — allowedTariffs enforcement', () => {
  beforeEach(() => setEnv());
  afterEach(() => {
    process.env = { ...ORIGINAL };
    vi.resetModules();
  });

  const item = { to: { city_code: 44 }, deliveryMode: 'pvz', items: [{ qty: 1 }] } as const;

  it('allowedTariffs задан, входной tariffCode разрешён → используется он', async () => {
    process.env.CDEK_ALLOWED_TARIFFS = '136,138';
    process.env.CDEK_DEFAULT_TARIFF = '136';
    const r = await calc({ ...item, tariffCode: 138 });
    expect(r.status).toBe(200);
    expect(r.data?.tariffCode).toBe(138);
  });

  it('SECURITY: входной tariffCode НЕ в whitelist → fallback на defaultTariffCode', async () => {
    process.env.CDEK_ALLOWED_TARIFFS = '136,138';
    process.env.CDEK_DEFAULT_TARIFF = '136';
    const r = await calc({ ...item, tariffCode: 999 });
    expect(r.status).toBe(200);
    expect(r.data?.tariffCode).toBe(136); // подменён на дефолт, не 999
  });

  it('tariffCode не передан → используется defaultTariffCode (как раньше)', async () => {
    process.env.CDEK_ALLOWED_TARIFFS = '136,138';
    process.env.CDEK_DEFAULT_TARIFF = '136';
    const r = await calc({ ...item });
    expect(r.status).toBe(200);
    expect(r.data?.tariffCode).toBe(136);
  });

  it('allowedTariffs пуст → любой tariffCode проходит (обратная совместимость)', async () => {
    delete process.env.CDEK_ALLOWED_TARIFFS;
    process.env.CDEK_DEFAULT_TARIFF = '136';
    const r = await calc({ ...item, tariffCode: 999 });
    expect(r.status).toBe(200);
    expect(r.data?.tariffCode).toBe(999);
  });
});
