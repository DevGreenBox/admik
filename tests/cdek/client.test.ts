import { describe, it, expect, vi } from 'vitest';
import { CdekClient, extractCdekErrors, retryAfterDelayMs } from '@/lib/cdek/client';
import { CdekError } from '@/lib/cdek/errors';
import { getCdekConfig } from '@/lib/cdek/config';

/**
 * Тесты HTTP-клиента СДЭК (docs/08 §2.2). Только с замоканным fetch (vi.fn) —
 * без реальной сети. Проверяем: Bearer-заголовок, маппинг ошибки СДЭК в
 * CdekError, ретрай 401 (сброс токена + повтор), ретрай 5xx.
 *
 * Боевой контракт (переход из mock, аудит 2026-07-09):
 *  • Авторетраи network/5xx/429 — ТОЛЬКО для ретраибельных запросов
 *    (GET/DELETE или idempotent: true). POST/PATCH без idempotent НЕ ретраятся:
 *    сеть/таймаут → 'cdek_network_error_unconfirmed' (запрос МОГ пройти у СДЭК).
 *  • 429 → ретрай с Retry-After (кап 3000мс) либо 'cdek_rate_limited'.
 *  • 401 → invalidate + один повтор со свежим токеном НЕЗАВИСИМО от числа
 *    сетевых попыток (отдельный флаг tokenRetried); разрешён и для POST.
 *  • Таймаут покрывает чтение тела ответа (зависший body-стрим → abort).
 */

/** Боевая конфигурация (ключи заданы → не mock). */
function realConfig() {
  return getCdekConfig({
    NODE_ENV: 'test',
    CDEK_ACCOUNT: 'acc-1',
    CDEK_SECRET: 'sec-1',
    CDEK_BASE_URL: 'https://api.edu.cdek.ru',
  });
}

/** Клиент с предустановленным mock-токеном (минуя /oauth/token). */
function makeClient(fetchImpl: typeof fetch) {
  let token = 'tok-1';
  const tokenCache = {
    getToken: vi.fn(async () => token),
    invalidate: vi.fn(async () => {
      token = 'tok-2'; // после сброса getToken вернёт свежий
    }),
  };
  const client = new CdekClient({ config: realConfig(), fetchImpl, tokenCache });
  return { client, tokenCache };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * Response-подобный объект с «зависшим» телом: text() не резолвится никогда,
 * но реджектится AbortError при срабатывании переданного signal (симулирует
 * реальный fetch, у которого abort прерывает чтение body-стрима).
 */
function hangingBodyResponse(init: RequestInit): Response {
  return {
    status: 200,
    headers: new Headers(),
    text: () =>
      new Promise<string>((_, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted', 'AbortError')),
        );
      }),
  } as unknown as Response;
}

describe('cdek/client — авторизация и запрос', () => {
  it('добавляет Authorization: Bearer <token> и Accept', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    const res = await client.request('GET', '/v2/deliverypoints', { query: { city_code: 44 } });

    expect(res).toEqual({ ok: true });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.edu.cdek.ru/v2/deliverypoints?city_code=44');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(init.headers.Accept).toBe('application/json');
    expect(init.method).toBe('GET');
  });

  it('POST с json ставит Content-Type и сериализует тело', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ entity: { uuid: 'u-1' } })) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await client.request('POST', '/v2/orders', { json: { number: 'ord-1' } });

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ number: 'ord-1' });
  });

  it('отбрасывает undefined query-параметры', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await client.request('GET', '/v2/deliverypoints', {
      query: { city_code: 44, postal_code: undefined },
    });
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.edu.cdek.ru/v2/deliverypoints?city_code=44');
  });

  it('конструктор без ключей кидает CdekError (mock-режим клиент не строит)', () => {
    const mockCfg = getCdekConfig({ NODE_ENV: 'test' });
    expect(() => new CdekClient({ config: mockCfg })).toThrow(CdekError);
  });
});

describe('cdek/client — обработка ошибок', () => {
  it('HTTP ≥ 400 маппится в CdekError с httpStatus и cdekErrors', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [{ code: 'v2_field_invalid', message: 'bad recipient' }] }, 400),
    ) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await expect(client.request('POST', '/v2/orders', { json: {} })).rejects.toMatchObject({
      name: 'CdekError',
      httpStatus: 400,
    });
    try {
      await client.request('POST', '/v2/orders', { json: {} });
    } catch (e) {
      const err = e as CdekError;
      expect(err.cdekErrors).toEqual([{ code: 'v2_field_invalid', message: 'bad recipient' }]);
    }
  });

  it('сетевая ошибка после исчерпания ретраев → CdekError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await expect(
      client.request('GET', '/v2/deliverypoints', { maxNetworkRetries: 0 }),
    ).rejects.toMatchObject({ name: 'CdekError', code: 'cdek_network_error' });
  });
});

describe('cdek/client — ретраи', () => {
  it('ретрай на 401: invalidateToken + один повтор со свежим токеном', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ errors: [] }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true })) as unknown as typeof fetch;
    const { client, tokenCache } = makeClient(fetchImpl);

    const res = await client.request('GET', '/v2/orders');

    expect(res).toEqual({ ok: true });
    expect(tokenCache.invalidate).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Второй запрос ушёл со свежим токеном tok-2.
    const [, init2] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(init2.headers.Authorization).toBe('Bearer tok-2');
  });

  it('401 повторяется ровно один раз (второй 401 пробрасывается)', async () => {
    // Фабрика (не mockResolvedValue): тело Response читается один раз, а клиент
    // теперь читает text() на каждой попытке — нужен свежий Response на вызов.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [] }, 401),
    ) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await expect(client.request('GET', '/v2/orders')).rejects.toMatchObject({
      name: 'CdekError',
      httpStatus: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // оригинал + один повтор
  });

  it('ретрай на 5xx: повторяет и в итоге возвращает успех', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true })) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    const res = await client.request('GET', '/v2/orders', { maxNetworkRetries: 2 });
    expect(res).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('5xx после исчерпания ретраев → CdekError', async () => {
    // Фабрика: свежий Response на каждый ретрай (см. коммент в тесте 401 выше).
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: [] }, 500),
    ) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await expect(
      client.request('GET', '/v2/orders', { maxNetworkRetries: 1 }),
    ).rejects.toMatchObject({ name: 'CdekError', httpStatus: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // оригинал + 1 ретрай
  });
});

describe('cdek/client — ретраи только для идемпотентных (боевой контракт)', () => {
  it('POST без idempotent: сетевая ошибка → БЕЗ ретраев, cdek_network_error_unconfirmed', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    // maxNetworkRetries дефолтный (2), но POST неидемпотентен → ноль авторетраев.
    await expect(client.request('POST', '/v2/orders', { json: {} })).rejects.toMatchObject({
      name: 'CdekError',
      code: 'cdek_network_error_unconfirmed',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Сообщение предупреждает вызывающего: запрос МОГ быть выполнен у СДЭК → сверка.
    try {
      await client.request('POST', '/v2/orders', { json: {} });
    } catch (e) {
      expect((e as CdekError).message).toMatch(/мог/i);
      expect((e as CdekError).message).toMatch(/сверк/i);
    }
  });

  it('POST без idempotent: 5xx → сразу CdekError без ретраев', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ errors: [] }, 503)) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await expect(client.request('POST', '/v2/orders', { json: {} })).rejects.toMatchObject({
      name: 'CdekError',
      httpStatus: 503,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('PATCH без idempotent: сетевая ошибка → cdek_network_error_unconfirmed без ретраев', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await expect(client.request('PATCH', '/v2/orders', { json: {} })).rejects.toMatchObject({
      code: 'cdek_network_error_unconfirmed',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('POST с idempotent: true → 5xx ретраится как раньше', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true })) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    const res = await client.request('POST', '/v2/orders', { json: {}, idempotent: true });
    expect(res).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('POST с idempotent: true → сетевая ошибка ретраится, код cdek_network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await expect(
      client.request('POST', '/v2/orders', { json: {}, idempotent: true, maxNetworkRetries: 1 }),
    ).rejects.toMatchObject({ code: 'cdek_network_error' });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // оригинал + 1 ретрай
  });

  it('DELETE ретраится по умолчанию (идемпотентен по методу)', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse({ ok: true })) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    const res = await client.request('DELETE', '/v2/orders/u-1');
    expect(res).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('cdek/client — 429 rate limit', () => {
  it('GET 429 → ретрай и успех (в пределах maxNetworkRetries)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true })) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    const res = await client.request('GET', '/v2/orders');
    expect(res).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('GET 429 без ретраев (maxNetworkRetries: 0) → cdek_rate_limited c httpStatus 429', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, 429)) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await expect(
      client.request('GET', '/v2/orders', { maxNetworkRetries: 0 }),
    ).rejects.toMatchObject({ name: 'CdekError', code: 'cdek_rate_limited', httpStatus: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('POST без idempotent: 429 → сразу cdek_rate_limited (без ретраев)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, 429, { 'Retry-After': '0' })) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await expect(client.request('POST', '/v2/orders', { json: {} })).rejects.toMatchObject({
      code: 'cdek_rate_limited',
      httpStatus: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retryAfterDelayMs: Retry-After в секундах → мс, кап 3000, фоллбэк 250/500', () => {
    expect(retryAfterDelayMs('2', 0)).toBe(2000); // 2с → 2000мс
    expect(retryAfterDelayMs('10', 0)).toBe(3000); // кап 3000мс
    expect(retryAfterDelayMs('0', 1)).toBe(0); // 0с валиден → без задержки
    expect(retryAfterDelayMs('abc', 0)).toBe(250); // не парсится → стандартная
    expect(retryAfterDelayMs(null, 0)).toBe(250); // нет заголовка → стандартная
    expect(retryAfterDelayMs(null, 1)).toBe(500);
    expect(retryAfterDelayMs(null, 5)).toBe(500); // хвост — последняя задержка
    expect(retryAfterDelayMs('-1', 0)).toBe(250); // отрицательное → стандартная
  });
});

describe('cdek/client — 401 и свежий токен (флаг tokenRetried)', () => {
  it('401 обновляет токен и ПОСЛЕ сетевого/5xx ретрая (не привязан к attempt 0)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503)) // сетевой ретрай съел attempt 0
      .mockResolvedValueOnce(jsonResponse({ errors: [] }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true })) as unknown as typeof fetch;
    const { client, tokenCache } = makeClient(fetchImpl);

    const res = await client.request('GET', '/v2/orders');

    expect(res).toEqual({ ok: true });
    expect(tokenCache.invalidate).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [, init3] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[2];
    expect(init3.headers.Authorization).toBe('Bearer tok-2'); // свежий токен
  });

  it('401-повтор разрешён и для неидемпотентного POST (401 = запрос не обработан)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ errors: [] }, 401))
      .mockResolvedValueOnce(jsonResponse({ entity: { uuid: 'u-1' } })) as unknown as typeof fetch;
    const { client, tokenCache } = makeClient(fetchImpl);

    const res = await client.request('POST', '/v2/orders', { json: { number: 'ord-1' } });

    expect(res).toEqual({ entity: { uuid: 'u-1' } });
    expect(tokenCache.invalidate).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('cdek/client — таймаут покрывает чтение тела', () => {
  it('зависшее тело: GET ретраится и добивается успеха', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init: RequestInit) => hangingBodyResponse(init))
      .mockResolvedValueOnce(jsonResponse({ ok: true })) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    const res = await client.request('GET', '/v2/orders', { timeoutMs: 30, maxNetworkRetries: 1 });
    expect(res).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('зависшее тело: POST без idempotent → cdek_network_error_unconfirmed', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) =>
      hangingBodyResponse(init),
    ) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await expect(
      client.request('POST', '/v2/orders', { json: {}, timeoutMs: 30 }),
    ).rejects.toMatchObject({ code: 'cdek_network_error_unconfirmed' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('зависшее тело: GET без ретраев → cdek_network_error', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) =>
      hangingBodyResponse(init),
    ) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    await expect(
      client.request('GET', '/v2/orders', { timeoutMs: 30, maxNetworkRetries: 0 }),
    ).rejects.toMatchObject({ code: 'cdek_network_error' });
  });
});

describe('cdek/client — extractCdekErrors (top-level + requests[].errors[])', () => {
  it('собирает top-level errors[]', () => {
    expect(extractCdekErrors({ errors: [{ code: 'a', message: 'A' }] })).toEqual([
      { code: 'a', message: 'A' },
    ]);
  });

  it('собирает requests[].errors[] (асинхронный формат заказов)', () => {
    const body = {
      requests: [
        { request_uuid: 'r1', state: 'INVALID', errors: [{ code: 'v2_field', message: 'bad' }] },
        { request_uuid: 'r2', state: 'INVALID', errors: [{ code: 'v2_other', message: 'x' }] },
      ],
    };
    expect(extractCdekErrors(body)).toEqual([
      { code: 'v2_field', message: 'bad' },
      { code: 'v2_other', message: 'x' },
    ]);
  });

  it('объединяет оба источника с дедупом по code+message', () => {
    const body = {
      errors: [{ code: 'dup', message: 'same' }],
      requests: [
        { errors: [{ code: 'dup', message: 'same' }, { code: 'uniq', message: 'u' }] },
        { errors: 'не массив' },
        null,
      ],
    };
    expect(extractCdekErrors(body)).toEqual([
      { code: 'dup', message: 'same' },
      { code: 'uniq', message: 'u' },
    ]);
  });

  it('мусорные значения → пустой массив', () => {
    expect(extractCdekErrors(null)).toEqual([]);
    expect(extractCdekErrors('строка')).toEqual([]);
    expect(extractCdekErrors({ errors: 'x', requests: 5 })).toEqual([]);
  });

  it('HTTP 400 с ошибками ТОЛЬКО в requests[].errors[] → cdekErrors заполнен', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { requests: [{ state: 'INVALID', errors: [{ code: 'v2_field_invalid', message: 'bad phone' }] }] },
        400,
      ),
    ) as unknown as typeof fetch;
    const { client } = makeClient(fetchImpl);

    try {
      await client.request('POST', '/v2/orders', { json: {} });
      expect.unreachable('должен был бросить CdekError');
    } catch (e) {
      const err = e as CdekError;
      expect(err.httpStatus).toBe(400);
      expect(err.cdekErrors).toEqual([{ code: 'v2_field_invalid', message: 'bad phone' }]);
    }
  });
});
