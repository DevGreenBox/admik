import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AdmikApiError,
  mapPaymentMethod,
  mapDeliveryType,
  listProducts,
  getProduct,
  quoteCart,
  createOrder,
  getOrder,
  cdekPvz,
  getSettings,
  getPage,
  submitLead,
  subscribeNewsletter,
  buildPageviewRequest,
  recordPageview,
} from './client';

const CFG = { baseUrl: 'https://admik.test/', apiKey: 'secret-key' };

/** Хелпер: мок Response с конвертом Admik. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('перекодировки', () => {
  it('mapPaymentMethod', () => {
    expect(mapPaymentMethod('cdek-pay')).toBe('cdek_pay');
    expect(mapPaymentMethod('CARD')).toBe('card');
    expect(mapPaymentMethod('sbp')).toBe('sbp');
    expect(mapPaymentMethod('что-то')).toBe('unset');
  });
  it('mapDeliveryType', () => {
    expect(mapDeliveryType('pvz')).toBe('pvz');
    expect(mapDeliveryType('door')).toBe('courier');
    expect(mapDeliveryType('???')).toBe('pvz');
  });
});

describe('request: база, ключ, конверт', () => {
  it('собирает URL /api/storefront/v1 без двойного слеша и шлёт X-Storefront-Key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [], pagination: {} }));
    await listProducts({ q: 'халат', limit: 10 }, CFG);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://admik.test/api/storefront/v1/products?q=%D1%85%D0%B0%D0%BB%D0%B0%D1%82&limit=10');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Storefront-Key']).toBe('secret-key');
    expect(headers.Accept).toBe('application/json');
  });

  it('разворачивает { data } в результат', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ slug: 'a' }] }));
    const rows = await listProducts({}, CFG);
    expect(rows).toEqual([{ slug: 'a' }]);
  });

  it('фасет по slug категории → query category=<slug>', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await listProducts({ category: 'women', sale: true }, CFG);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('category=women');
    expect(url).toContain('sale=1');
  });

  it('бросает AdmikApiError с кодом/статусом из конверта ошибки', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'rate_limited', message: 'Слишком много' } }, 429),
    );
    await expect(listProducts({}, CFG)).rejects.toMatchObject({
      name: 'AdmikApiError',
      status: 429,
      code: 'rate_limited',
    });
  });

  it('без baseUrl → AdmikApiError(status=0)', async () => {
    await expect(listProducts({}, { baseUrl: '', apiKey: null })).rejects.toBeInstanceOf(
      AdmikApiError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getProduct', () => {
  it('200 → DTO', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { slug: 'p1' } }));
    const p = await getProduct('p1', CFG);
    expect(p).toEqual({ slug: 'p1' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://admik.test/api/storefront/v1/products/p1');
  });
  it('404 → null (а не throw)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'not_found', message: 'нет' } }, 404),
    );
    expect(await getProduct('missing', CFG)).toBeNull();
  });
  it('кодирует slug', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: {} }));
    await getProduct('a b/c', CFG);
    expect(fetchMock.mock.calls[0][0]).toContain('/products/a%20b%2Fc');
  });
});

describe('quoteCart / createOrder (POST)', () => {
  it('quoteCart: POST с телом и Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { grandTotal: '4900.00' } }));
    await quoteCart({ items: [{ variantId: 'v1', qty: 2 }] }, CFG);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://admik.test/api/storefront/v1/cart/quote');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ items: [{ variantId: 'v1', qty: 2 }] });
  });

  it('createOrder: передаёт Idempotency-Key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { number: 'TC-1', accessToken: 't' } }, 201));
    await createOrder(
      {
        items: [{ variantId: 'v1', qty: 1 }],
        customer: { name: 'Иван', email: 'i@e.ru', phone: '+700' },
        delivery: { type: 'pvz', pvzCode: 'MSK1' },
        paymentMethod: 'cdek_pay',
      },
      { idempotencyKey: 'idem-123', config: CFG },
    );
    const init = fetchMock.mock.calls[0][1];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-123');
  });
});

describe('getOrder', () => {
  it('200 → DTO, token уходит в query', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { number: 'TC-1', status: 'new' } }),
    );
    const o = await getOrder('TC-1', { token: 'tok-abc' }, CFG);
    expect(o).toEqual({ number: 'TC-1', status: 'new' });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://admik.test/api/storefront/v1/orders/TC-1?token=tok-abc',
    );
  });

  it('email-подтверждение → query email=', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { number: 'TC-2' } }));
    await getOrder('TC-2', { email: 'i@e.ru' }, CFG);
    expect(fetchMock.mock.calls[0][0]).toContain('email=i%40e.ru');
  });

  it('404 → null (а не throw)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'not_found', message: 'нет' } }, 404),
    );
    expect(await getOrder('missing', { token: 'x' }, CFG)).toBeNull();
  });

  it('кодирует номер заказа', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: {} }));
    await getOrder('TC/1 2', { token: 't' }, CFG);
    expect(fetchMock.mock.calls[0][0]).toContain('/orders/TC%2F1%202?token=t');
  });
});

describe('cdekPvz', () => {
  it('city_code → query', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await cdekPvz({ cityCode: 44 }, CFG);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://admik.test/api/storefront/v1/delivery/cdek/pvz?city_code=44',
    );
  });
});

describe('getSettings', () => {
  it('GET /settings, разворачивает { data }', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { branding: { shopName: 'Магазин' }, contacts: { socials: [] } } }),
    );
    const s = await getSettings(CFG);
    expect(fetchMock.mock.calls[0][0]).toBe('https://admik.test/api/storefront/v1/settings');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method ?? 'GET').toBe('GET');
    expect(s).toEqual({ branding: { shopName: 'Магазин' }, contacts: { socials: [] } });
  });
});

describe('getPage (CMS)', () => {
  it('200 → страница; GET /pages/<slug>', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { slug: 'terms', title: 'Условия', meta: { title: 'Условия', description: null }, sections: [] } }),
    );
    const p = await getPage('terms', CFG);
    expect(fetchMock.mock.calls[0][0]).toBe('https://admik.test/api/storefront/v1/pages/terms');
    expect(p?.slug).toBe('terms');
  });
  it('404 → null (статический фолбэк)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'not_found', message: 'нет' } }, 404));
    expect(await getPage('missing', CFG)).toBeNull();
  });
  it('403 (модуль cms выключен) → null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'module_disabled', message: 'off' } }, 403));
    expect(await getPage('terms', CFG)).toBeNull();
  });
});

describe('submitLead (G-09)', () => {
  it('POST /leads с телом, разворачивает { data }', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'lead-1' } }, 200));
    const r = await submitLead({ name: 'Иван', contact: 'i@e.ru', message: 'm' }, CFG);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://admik.test/api/storefront/v1/leads');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Иван', contact: 'i@e.ru', message: 'm' });
    expect(r).toEqual({ id: 'lead-1' });
  });
});

describe('subscribeNewsletter (G-12)', () => {
  it('POST /newsletter с email', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }, 200));
    const r = await subscribeNewsletter('i@e.ru', CFG);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://admik.test/api/storefront/v1/newsletter');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ email: 'i@e.ru' });
    expect(r).toEqual({ ok: true });
  });
});

describe('buildPageviewRequest (F23)', () => {
  it('собирает URL /events/pageview, пустое тело, прокидывает ключ', () => {
    const r = buildPageviewRequest(CFG);
    expect(r.url).toBe('https://admik.test/api/storefront/v1/events/pageview');
    expect(r.apiKey).toBe('secret-key');
    expect(r.body).toBe('{}');
  });

  it('без ключа (браузерный запрос) → apiKey=null', () => {
    const r = buildPageviewRequest({ baseUrl: 'https://shop.test', apiKey: null });
    expect(r.url).toBe('https://shop.test/api/storefront/v1/events/pageview');
    expect(r.apiKey).toBeNull();
  });
});

describe('recordPageview (F23, beacon)', () => {
  it('server-side (есть ключ, нет navigator) → POST с keepalive и X-Storefront-Key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }, 200));
    await recordPageview(CFG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://admik.test/api/storefront/v1/events/pageview');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(init.body).toBe('{}');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Storefront-Key']).toBe('secret-key');
  });

  it('браузер без ключа: использует navigator.sendBeacon, fetch НЕ вызывается', async () => {
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    await recordPageview({ baseUrl: 'https://shop.test', apiKey: null });
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe('https://shop.test/api/storefront/v1/events/pageview');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('beacon-blob имеет тип text/plain (CORS-safelist → без preflight)', async () => {
    // application/json НЕ входит в CORS-safelist content-type → sendBeacon
    // вынужден делать preflight в режиме credentials:include и браузер режет его.
    // text/plain делает запрос «простым»: без preflight, доходит до Admik. Тело
    // роутом игнорируется, поэтому content-type значения для сервера не имеет.
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    await recordPageview({ baseUrl: 'https://shop.test', apiKey: null });
    const blob = beacon.mock.calls[0][1] as Blob;
    expect(blob.type).toBe('text/plain');
  });

  it('нет baseUrl → ничего не шлёт (тихий выход)', async () => {
    await recordPageview({ baseUrl: '', apiKey: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ошибка сети глотается (не бросает)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(recordPageview(CFG)).resolves.toBeUndefined();
  });
});
