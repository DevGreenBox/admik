import { beforeEach, describe, it, expect, vi } from 'vitest';
import { CdekManager } from '@/lib/cdek/manager';
import { getCdekConfig } from '@/lib/cdek/config';
import {
  PvzService,
  PVZ_LIST_CACHE_TTL_SEC,
  PVZ_PAGE_SIZE,
  PVZ_MAX_PAGES,
  pvzListCacheKey,
  __resetPvzCacheFallbackForTests,
} from '@/lib/cdek/services/pvz';
import { MemoryTokenStore, type TokenStore } from '@/lib/cdek/token-cache';

/**
 * Тесты PvzService (docs/08 §6; боевой контракт — apidoc.cdek.ru deliverypoints,
 * выжимка 2026-07-09). Mock-путь — фикстуры. Real-путь — замоканный
 * manager.client (без сети): маппинг, пагинация size/page, фильтр is_handout,
 * кеш списка (рекомендация СДЭК: обновлять справочник не чаще раза в сутки,
 * общий лимит 200 RPS → без кеша каждый запрос витрины бьёт живой API).
 */

const mockCfg = getCdekConfig({ NODE_ENV: 'test' });
const realCfg = getCdekConfig({
  NODE_ENV: 'test',
  CDEK_ACCOUNT: 'acc-1',
  CDEK_SECRET: 'sec-1',
  CDEK_BASE_URL: 'https://api.edu.cdek.ru',
});

/** Сырой офис СДЭК для real-тестов. */
function rawOfficeFixture(code = 'MSK77'): Record<string, unknown> {
  return {
    code,
    name: 'ПВЗ Москва тест',
    location: {
      address_full: 'Москва, ул. Тестовая, 1',
      city_code: 44,
      latitude: 55.7,
      longitude: 37.6,
    },
    type: 'PVZ',
    work_time: 'Пн-Пт 10-20',
  };
}

/**
 * Manager с fetch-очередью ответов: каждый вызов забирает следующее тело;
 * когда очередь пуста — повторяется последнее (для одностраничных тестов
 * достаточно одного тела).
 */
function makeManager(...bodies: unknown[]) {
  const queue = [...bodies];
  const fetchImpl = vi.fn(async () => {
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const tokenCache = { getToken: vi.fn(async () => 'tok-X'), invalidate: vi.fn(async () => {}) };
  return { m: new CdekManager({ config: realCfg, fetchImpl, tokenCache }), fetchImpl };
}

/** PvzService с ИЗОЛИРОВАННЫМ кешем (fresh MemoryTokenStore на тест). */
function makePvz(...bodies: unknown[]) {
  const { m, fetchImpl } = makeManager(...bodies);
  const store = new MemoryTokenStore();
  const pvz = new PvzService(m, { cacheStore: store });
  return { pvz, fetchImpl, store, m };
}

function fetchUrls(fetchImpl: unknown): string[] {
  return (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
}

describe('cdek/pvz — mock-путь (фикстуры)', () => {
  const m = new CdekManager({ config: mockCfg });
  const pvz = new PvzService(m);

  it('listOffices по городу 44 непуст', async () => {
    const offices = await pvz.listOffices({ cityCode: 44 });
    expect(offices.length).toBeGreaterThan(0);
    expect(offices.every((o) => o.cityCode === 44)).toBe(true);
  });

  it('listOffices по городу 137 (СПб) непуст', async () => {
    const offices = await pvz.listOffices({ cityCode: 137 });
    expect(offices.length).toBeGreaterThan(0);
  });

  it('фильтр по типу POSTAMAT', async () => {
    const offices = await pvz.listOffices({ type: 'POSTAMAT' });
    expect(offices.length).toBeGreaterThan(0);
    expect(offices.every((o) => o.type === 'POSTAMAT')).toBe(true);
  });

  it('listOffices без фильтров возвращает все фикстуры', async () => {
    const offices = await pvz.listOffices({});
    expect(offices.length).toBeGreaterThanOrEqual(3);
  });

  it('mock-ветка НЕ трогает кеш (store не вызывается)', async () => {
    const store: TokenStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      del: vi.fn(async () => {}),
    };
    const cachedPvz = new PvzService(m, { cacheStore: store });
    const offices = await cachedPvz.listOffices({ cityCode: 44 });
    expect(offices.length).toBeGreaterThan(0);
    expect(store.get).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('findOffice по существующему коду', async () => {
    const office = await pvz.findOffice('MSK1');
    expect(office).not.toBeNull();
    expect(office?.code).toBe('MSK1');
  });

  it('findOffice по несуществующему коду → null', async () => {
    const office = await pvz.findOffice('NOPE');
    expect(office).toBeNull();
  });

  it('findOffice пустой код → null', async () => {
    expect(await pvz.findOffice('')).toBeNull();
    expect(await pvz.findOffice('   ')).toBeNull();
  });
});

describe('cdek/pvz — real-путь (замоканный manager.client)', () => {
  const rawOffice = rawOfficeFixture();

  it('listOffices маппит ответ /v2/deliverypoints (массив)', async () => {
    const { pvz } = makePvz([rawOffice]);
    const offices = await pvz.listOffices({ cityCode: 44 });
    expect(offices).toHaveLength(1);
    expect(offices[0].code).toBe('MSK77');
    expect(offices[0].address).toBe('Москва, ул. Тестовая, 1');
    expect(offices[0].cityCode).toBe(44);
    expect(offices[0].location).toEqual({ latitude: 55.7, longitude: 37.6 });
    expect(offices[0].workTime).toBe('Пн-Пт 10-20');
  });

  it('listOffices передаёт фильтры в query', async () => {
    const { pvz, fetchImpl } = makePvz([rawOffice]);
    await pvz.listOffices({ cityCode: 44, type: 'PVZ' });
    const [url] = fetchUrls(fetchImpl);
    expect(url).toContain('/v2/deliverypoints');
    expect(url).toContain('city_code=44');
    expect(url).toContain('type=PVZ');
  });

  it('findOffice по коду → первый из ответа', async () => {
    const { pvz } = makePvz([rawOffice]);
    const office = await pvz.findOffice('MSK77');
    expect(office?.code).toBe('MSK77');
  });

  it('findOffice → null когда СДЭК вернул пустой массив', async () => {
    const { pvz } = makePvz([]);
    expect(await pvz.findOffice('MSK77')).toBeNull();
  });

  it('listOffices устойчив к не-массиву в ответе', async () => {
    const { pvz } = makePvz({ unexpected: true });
    expect(await pvz.listOffices({ cityCode: 44 })).toEqual([]);
  });
});

describe('cdek/pvz — фильтр is_handout (выдача заказа покупателю)', () => {
  // apidoc deliverypoints: поле ответа is_handout — «пункт выдачи». Витрина
  // показывает ПВЗ для ВЫДАЧИ заказа: офисы только-приёма (is_handout=false)
  // покупателю бесполезны и отбрасываются. Отсутствие поля трактуем как
  // «выдающий» (не отфильтровать всё при смене схемы ответа).
  it('офис с is_handout=false отброшен; true/отсутствует — остаются', async () => {
    const { pvz } = makePvz([
      { ...rawOfficeFixture('GIVE1'), is_handout: true },
      { ...rawOfficeFixture('TAKE1'), is_handout: false },
      rawOfficeFixture('NOFLAG'),
    ]);
    const offices = await pvz.listOffices({ cityCode: 44 });
    expect(offices.map((o) => o.code)).toEqual(['GIVE1', 'NOFLAG']);
  });
});

describe('cdek/pvz — пагинация size/page', () => {
  // /v2/deliverypoints (в отличие от /v2/location/cities) НЕ пагинирует size/page —
  // отдаёт ВЕСЬ отфильтрованный список за один ответ. size/page шлём защитно, но
  // добор устойчив к игнору page: дедуп по коду офиса + остановка, когда страница
  // не добавила новых кодов (иначе мегаполисы давали бы N-кратные дубли).
  function pageOf(n: number, prefix: string): Record<string, unknown>[] {
    return Array.from({ length: n }, (_, i) => rawOfficeFixture(`${prefix}${i}`));
  }

  it('запрос содержит явные size=1000 и page=0', async () => {
    const { pvz, fetchImpl } = makePvz([rawOfficeFixture()]);
    await pvz.listOffices({ cityCode: 44 });
    const [url] = fetchUrls(fetchImpl);
    expect(url).toContain(`size=${PVZ_PAGE_SIZE}`);
    expect(url).toContain('page=0');
    expect(PVZ_PAGE_SIZE).toBe(1000);
  });

  it('неполная страница → ровно один запрос', async () => {
    const { pvz, fetchImpl } = makePvz(pageOf(3, 'A'));
    const offices = await pvz.listOffices({ cityCode: 44 });
    expect(offices).toHaveLength(3);
    expect(fetchUrls(fetchImpl)).toHaveLength(1);
  });

  it('полная страница → добор следующей до неполной', async () => {
    const { pvz, fetchImpl } = makePvz(pageOf(PVZ_PAGE_SIZE, 'A'), pageOf(2, 'B'));
    const offices = await pvz.listOffices({ cityCode: 44 });
    expect(offices).toHaveLength(PVZ_PAGE_SIZE + 2);
    const urls = fetchUrls(fetchImpl);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('page=0');
    expect(urls[1]).toContain('page=1');
  });

  it('пустая страница-продолжение останавливает добор', async () => {
    const { pvz, fetchImpl } = makePvz(pageOf(PVZ_PAGE_SIZE, 'A'), []);
    const offices = await pvz.listOffices({ cityCode: 44 });
    expect(offices).toHaveLength(PVZ_PAGE_SIZE);
    expect(fetchUrls(fetchImpl)).toHaveLength(2);
  });

  // РЕГРЕСС (боевой аудит 2026-07-09, находка #1): /v2/deliverypoints игнорирует
  // page и отдаёт ВЕСЬ полный список на каждой странице. Мегаполис (Москва >1000
  // ПВЗ) без дедупа давал бы 10-кратные дубли, закешированные на 6ч. Дедуп по коду
  // + ранняя остановка: полный список берётся один раз, повтор кодов на page=1
  // прекращает добор.
  it('апстрим повторяет полный список (page игнорируется) → дедуп без N-кратных дублей', async () => {
    // makePvz с ОДНИМ телом возвращает его на КАЖДЫЙ запрос (эмуляция игнора page).
    const { pvz, fetchImpl } = makePvz(pageOf(PVZ_PAGE_SIZE, 'X'));
    const offices = await pvz.listOffices({ cityCode: 44 });
    // Без 10-кратных дублей: ровно PVZ_PAGE_SIZE уникальных офисов.
    expect(offices).toHaveLength(PVZ_PAGE_SIZE);
    const codes = offices.map((o) => o.code);
    expect(new Set(codes).size).toBe(PVZ_PAGE_SIZE);
    // Ранняя остановка: page=0 (полный список) + page=1 (0 новых кодов) = 2 запроса,
    // а не PVZ_MAX_PAGES.
    expect(fetchUrls(fetchImpl)).toHaveLength(2);
  });

  it('кап PVZ_MAX_PAGES ограничивает добор (константа = 10)', () => {
    expect(PVZ_MAX_PAGES).toBe(10);
  });
});

describe('cdek/pvz — фильтры веса weight_max/weight_min', () => {
  // apidoc deliverypoints: weight_max/weight_min — int ≥0 в КИЛОГРАММАХ
  // (вес, который офис принимает). Вход сервиса — граммы (конвенция витрины,
  // как weightG в calculate). Конверсия консервативна: weight_max=ceil(кг)
  // (офис обязан принимать НЕ МЕНЬШЕ веса посылки), weight_min=floor(кг) и
  // только при >0 (иначе фильтр не передаётся — не сузить список зря).
  it('weightGrams=1500 → weight_max=2, weight_min=1', async () => {
    const { pvz, fetchImpl } = makePvz([rawOfficeFixture()]);
    await pvz.listOffices({ cityCode: 44, weightGrams: 1500 });
    const [url] = fetchUrls(fetchImpl);
    expect(url).toContain('weight_max=2');
    expect(url).toContain('weight_min=1');
  });

  it('weightGrams=500 → weight_max=1, weight_min НЕ передаётся', async () => {
    const { pvz, fetchImpl } = makePvz([rawOfficeFixture()]);
    await pvz.listOffices({ cityCode: 44, weightGrams: 500 });
    const [url] = fetchUrls(fetchImpl);
    expect(url).toContain('weight_max=1');
    expect(url).not.toContain('weight_min=');
  });

  it('без weightGrams фильтры веса не передаются', async () => {
    const { pvz, fetchImpl } = makePvz([rawOfficeFixture()]);
    await pvz.listOffices({ cityCode: 44 });
    const [url] = fetchUrls(fetchImpl);
    expect(url).not.toContain('weight_max=');
    expect(url).not.toContain('weight_min=');
  });
});

describe('cdek/pvz — кеш списка (real-ветка)', () => {
  // Рекомендация СДЭК (apidoc deliverypoints): не хранить статичный список,
  // обновлять кэш раз в сутки; общий лимит 200 RPS. TTL 6ч — компромисс
  // задачи (свежее суток, но витрина не бьёт живой API каждым запросом).
  beforeEach(() => {
    __resetPvzCacheFallbackForTests();
  });

  it('TTL кеша — 6 часов', () => {
    expect(PVZ_LIST_CACHE_TTL_SEC).toBe(6 * 60 * 60);
  });

  it('повторный вызов с теми же фильтрами отдаёт кеш без сети', async () => {
    const { pvz, fetchImpl } = makePvz([rawOfficeFixture()]);
    const first = await pvz.listOffices({ cityCode: 44, type: 'PVZ' });
    const second = await pvz.listOffices({ cityCode: 44, type: 'PVZ' });
    expect(fetchUrls(fetchImpl)).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('кеш общий между экземплярами сервиса (store процесса, роут создаёт сервис на запрос)', async () => {
    const { m, fetchImpl } = makeManager([rawOfficeFixture()]);
    const store = new MemoryTokenStore();
    const a = new PvzService(m, { cacheStore: store });
    const b = new PvzService(m, { cacheStore: store });
    await a.listOffices({ cityCode: 44 });
    await b.listOffices({ cityCode: 44 });
    expect(fetchUrls(fetchImpl)).toHaveLength(1);
  });

  it('другие фильтры → отдельный ключ кеша', async () => {
    const { pvz, fetchImpl } = makePvz([rawOfficeFixture()]);
    await pvz.listOffices({ cityCode: 44 });
    await pvz.listOffices({ cityCode: 137 });
    expect(fetchUrls(fetchImpl)).toHaveLength(2);
  });

  it('вес входит в ключ кеша', async () => {
    const { pvz, fetchImpl } = makePvz([rawOfficeFixture()]);
    await pvz.listOffices({ cityCode: 44, weightGrams: 500 });
    await pvz.listOffices({ cityCode: 44, weightGrams: 1500 });
    expect(fetchUrls(fetchImpl)).toHaveLength(2);
  });

  it('после истечения TTL — повторный запрос к СДЭК', async () => {
    const { pvz, fetchImpl, store } = makePvz([rawOfficeFixture()]);
    await pvz.listOffices({ cityCode: 44 });
    store.__advance(PVZ_LIST_CACHE_TTL_SEC * 1000 + 1000);
    await pvz.listOffices({ cityCode: 44 });
    expect(fetchUrls(fetchImpl)).toHaveLength(2);
  });

  it('не-массив в ответе НЕ кешируется (следующий вызов снова идёт в сеть)', async () => {
    const { pvz, fetchImpl } = makePvz({ unexpected: true });
    expect(await pvz.listOffices({ cityCode: 44 })).toEqual([]);
    expect(await pvz.listOffices({ cityCode: 44 })).toEqual([]);
    expect(fetchUrls(fetchImpl)).toHaveLength(2);
  });

  it('недоступный store (Redis down) не валит запрос: fallback in-memory кеширует', async () => {
    const broken: TokenStore = {
      get: vi.fn(async () => {
        throw new Error('redis down');
      }),
      set: vi.fn(async () => {
        throw new Error('redis down');
      }),
      del: vi.fn(async () => {
        throw new Error('redis down');
      }),
    };
    const { m, fetchImpl } = makeManager([rawOfficeFixture()]);
    const pvz = new PvzService(m, { cacheStore: broken });
    const first = await pvz.listOffices({ cityCode: 44 });
    expect(first).toHaveLength(1);
    // Второй вызов — из fallback-памяти процесса, сеть не дёргается повторно.
    const second = await pvz.listOffices({ cityCode: 44 });
    expect(second).toEqual(first);
    expect(fetchUrls(fetchImpl)).toHaveLength(1);
  });

  it('битый JSON в кеше игнорируется (идём в сеть)', async () => {
    const { pvz, fetchImpl, store } = makePvz([rawOfficeFixture()]);
    const key = pvzListCacheKey(realCfg.baseUrl, { cityCode: 44 });
    await store.set(key, '{битый json', 60);
    const offices = await pvz.listOffices({ cityCode: 44 });
    expect(offices).toHaveLength(1);
    expect(fetchUrls(fetchImpl)).toHaveLength(1);
  });

  it('ключ кеша включает контур (baseUrl): edu и prod не делят кеш', () => {
    const edu = pvzListCacheKey('https://api.edu.cdek.ru', { cityCode: 44 });
    const prod = pvzListCacheKey('https://api.cdek.ru', { cityCode: 44 });
    expect(edu).not.toBe(prod);
  });
});
