import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { CdekManager } from '@/lib/cdek/manager';
import { getCdekConfig } from '@/lib/cdek/config';
import {
  Calculator,
  aggregatePackage,
  resetCalculatorRuntimeCaches,
  type CartLineDims,
} from '@/lib/cdek/services/calculator';
import { CDEK_FALLBACK_DIMENSIONS } from '@/lib/cdek/config';
import { CdekError } from '@/lib/cdek/errors';
import { resetDefaultTokenStore } from '@/lib/cdek/token-cache';

/**
 * Тесты Calculator (docs/08 §5). Mock-путь — формула детерминирована. Real-путь —
 * замоканный manager.client (без сети): проверяем маппинг ответа СДЭК. Агрегация
 * веса корзины — чистая функция.
 *
 * Кеши real-ветки (котировки TTL 300с + город ПВЗ отгрузки TTL 1ч) — модульные,
 * поэтому каждый тест начинается со сброса (resetCalculatorRuntimeCaches +
 * resetDefaultTokenStore), иначе результат одного теста утекает в следующий.
 */

const mockCfg = getCdekConfig({ NODE_ENV: 'test' });
const realCfg = getCdekConfig({
  NODE_ENV: 'test',
  CDEK_ACCOUNT: 'acc-1',
  CDEK_SECRET: 'sec-1',
  CDEK_BASE_URL: 'https://api.edu.cdek.ru',
});

const defaults = mockCfg.defaultDimensions;

beforeEach(() => {
  resetCalculatorRuntimeCaches();
  resetDefaultTokenStore();
});

describe('cdek/calculator — aggregatePackage (чистая агрегация корзины)', () => {
  it('суммирует вес × qty, габариты: Д/Ш = max, В = Σ', () => {
    const lines: CartLineDims[] = [
      { qty: 2, weightG: 300, lengthCm: 20, widthCm: 10, heightCm: 5 },
      { qty: 1, weightG: 500, lengthCm: 30, widthCm: 15, heightCm: 8 },
    ];
    const pkg = aggregatePackage(lines, defaults);
    expect(pkg.weight).toBe(300 * 2 + 500); // 1100 г
    expect(pkg.length).toBe(30); // max(20,30)
    expect(pkg.width).toBe(15); // max(10,15)
    expect(pkg.height).toBe(5 * 2 + 8); // 18 = Σ(qty*h)
  });

  it('NULL веса/габаритов позиции → дефолт магазина', () => {
    const lines: CartLineDims[] = [{ qty: 1 }];
    const pkg = aggregatePackage(lines, defaults);
    expect(pkg.weight).toBe(defaults.weightG);
    expect(pkg.length).toBe(defaults.lengthCm);
    expect(pkg.width).toBe(defaults.widthCm);
    expect(pkg.height).toBe(defaults.heightCm);
  });

  it('пустая корзина → одна дефолтная упаковка магазина', () => {
    const pkg = aggregatePackage([], defaults);
    expect(pkg.weight).toBe(defaults.weightG);
    expect(pkg.length).toBe(defaults.lengthCm);
  });

  it('фоллбэк последней инстанции при отсутствии дефолтов магазина', () => {
    const pkg = aggregatePackage([{ qty: 1 }]);
    expect(pkg.weight).toBe(CDEK_FALLBACK_DIMENSIONS.weightG);
  });

  it('вес/высота умножаются на qty; ширина/длина не умножаются (max)', () => {
    const pkg = aggregatePackage(
      [{ qty: 3, weightG: 100, lengthCm: 10, widthCm: 10, heightCm: 4 }],
      defaults,
    );
    expect(pkg.weight).toBe(300);
    expect(pkg.height).toBe(12);
    expect(pkg.length).toBe(10);
    expect(pkg.width).toBe(10);
  });
});

describe('cdek/calculator — mock-путь (детерминированная формула)', () => {
  const m = new CdekManager({ config: mockCfg });
  const calc = new Calculator(m);

  it('calculate возвращает формулу §5.3 (base + perKg*kg)', async () => {
    const res = await calc.calculate({
      to: { code: 137 },
      packages: [{ weight: 500 }],
      tariffCode: 136, // ПВЗ
    });
    // 300 + 100*1 = 400
    expect(res.deliverySum).toBe('400.00');
    expect(res.tariffCode).toBe(136);
    expect(res.periodMin).toBe(2);
    expect(res.periodMax).toBe(5);
  });

  it('курьерский тариф (door) дороже на надбавку', async () => {
    const res = await calc.calculate({
      to: { code: 137 },
      packages: [{ weight: 1500 }],
      tariffCode: 137, // door
    });
    // 300 + 100*2 + 150 = 650
    expect(res.deliverySum).toBe('650.00');
  });

  it('calculate детерминирован: одинаковые входы → одинаковый результат', async () => {
    const a = await calc.calculate({ to: { code: 44 }, packages: [{ weight: 800 }], tariffCode: 136 });
    const b = await calc.calculate({ to: { code: 44 }, packages: [{ weight: 800 }], tariffCode: 136 });
    expect(a).toEqual(b);
  });

  it('calculateAvailable возвращает фикстурный набор тарифов', async () => {
    const list = await calc.calculateAvailable({ to: { code: 137 }, packages: [{ weight: 500 }] });
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.every((t) => typeof t.tariffCode === 'number')).toBe(true);
  });

  it('собирает packages из позиций корзины', async () => {
    const res = await calc.calculate({
      to: { code: 137 },
      lines: [{ qty: 2, weightG: 500 }], // 1000 г = 1 кг
      tariffCode: 136,
    });
    // 300 + 100*1 = 400
    expect(res.deliverySum).toBe('400.00');
  });
});

describe('cdek/calculator — real-путь (замоканный manager.client)', () => {
  function makeManager(responseBody: unknown) {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const tokenCache = { getToken: vi.fn(async () => 'tok-X'), invalidate: vi.fn(async () => {}) };
    return new CdekManager({ config: realCfg, fetchImpl, tokenCache });
  }

  it('маппинг ответа /v2/calculator/tariff → CdekTariffResult', async () => {
    const m = makeManager({ delivery_sum: 450, period_min: 1, period_max: 3, tariff_code: 136 });
    const calc = new Calculator(m);
    const res = await calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    expect(res.deliverySum).toBe('450.00');
    expect(res.periodMin).toBe(1);
    expect(res.periodMax).toBe(3);
    expect(res.tariffCode).toBe(136);
  });

  it('отправляет from_location из конфига (анти-tamper) и packages', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ delivery_sum: 400, period_min: 2, period_max: 5, tariff_code: 136 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const tokenCache = { getToken: vi.fn(async () => 't'), invalidate: vi.fn(async () => {}) };
    const m = new CdekManager({ config: realCfg, fetchImpl, tokenCache });
    const calc = new Calculator(m);
    await calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });

    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/v2/calculator/tariff');
    const body = JSON.parse(init.body as string);
    expect(body.from_location.code).toBe(realCfg.fromLocationCode);
    expect(body.to_location.code).toBe(137);
    expect(body.tariff_code).toBe(136);
    expect(body.packages[0].weight).toBe(500);
  });

  it('маппинг ответа /v2/calculator/tarifflist → CdekTariffOption[]', async () => {
    const m = makeManager({
      tariff_codes: [
        { tariff_code: 136, tariff_name: 'Склад-склад', delivery_sum: 400, period_min: 2, period_max: 5, delivery_mode: 4 },
        { tariff_code: 137, tariff_name: 'Склад-дверь', delivery_sum: 550, period_min: 2, period_max: 5, delivery_mode: 3 },
      ],
    });
    const calc = new Calculator(m);
    const list = await calc.calculateAvailable({ to: { code: 137 }, packages: [{ weight: 500 }] });
    expect(list).toHaveLength(2);
    expect(list[0].tariffCode).toBe(136);
    expect(list[0].deliverySum).toBe('400.00');
    expect(list[1].tariffName).toBe('Склад-дверь');
  });

  it('пустой/отсутствующий tariff_codes → []', async () => {
    const m = makeManager({});
    const calc = new Calculator(m);
    const list = await calc.calculateAvailable({ to: { code: 137 }, packages: [{ weight: 500 }] });
    expect(list).toEqual([]);
  });
});

/**
 * BUG B (CRITICAL, undercharge): СДЭК на /v2/calculator/tariff может вернуть
 * HTTP 200 БЕЗ цены (delivery_sum/total_sum отсутствуют) — например, когда тариф
 * недоступен для назначения: тело несёт непустой errors[]. Раньше mapTariffResult
 * прогонял отсутствующее поле через toMoney(undefined) === '0.00' и Calculator
 * РЕЗОЛВИЛСЯ с deliverySum '0.00' (resolved-путь), а computeDeliveryCost не видел
 * throw → anti-undercharge guard НЕ срабатывал → заказ с бесплатной доставкой.
 *
 * Фикс: при отсутствии конечной цены ИЛИ непустом errors[] mapTariffResult бросает
 * CdekError('cdek_calc_no_price') — это превращается в DeliveryCalculationError
 * выше по стеку (createOrder → delivery_unavailable; quote softFail → resolved:false).
 * Легитимный нуль (delivery_sum: 0) остаётся валидным '0.00'.
 */
describe('cdek/calculator — real-путь: 200 без цены НЕ резолвится в 0.00 (BUG B)', () => {
  function makeManager(responseBody: unknown) {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const tokenCache = { getToken: vi.fn(async () => 'tok-X'), invalidate: vi.fn(async () => {}) };
    return new CdekManager({ config: realCfg, fetchImpl, tokenCache });
  }

  it('200 c errors[] и без delivery_sum → БРОСАЕТ CdekError (а НЕ 0.00 resolved)', async () => {
    const m = makeManager({
      errors: [{ code: 'v2_calc_tariff_unavailable', message: 'Тариф недоступен' }],
    });
    const calc = new Calculator(m);
    await expect(
      calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 }),
    ).rejects.toBeInstanceOf(CdekError);
  });

  it('200 без delivery_sum/total_sum (нет ни цены, ни errors) → БРОСАЕТ CdekError', async () => {
    const m = makeManager({ period_min: 2, period_max: 5, tariff_code: 136 });
    const calc = new Calculator(m);
    await expect(
      calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 }),
    ).rejects.toMatchObject({ code: 'cdek_calc_no_price' });
  });

  it('брошенная CdekError несёт structured errors[] СДЭК (для аудита/диагностики)', async () => {
    const m = makeManager({
      errors: [{ code: 'v2_no_tariff', message: 'нет тарифа' }],
    });
    const calc = new Calculator(m);
    let caught: unknown;
    try {
      await calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CdekError);
    expect((caught as CdekError).cdekErrors).toEqual([
      { code: 'v2_no_tariff', message: 'нет тарифа' },
    ]);
  });

  it('легитимный нуль (delivery_sum: 0, без errors) остаётся валидным 0.00 resolved', async () => {
    const m = makeManager({ delivery_sum: 0, period_min: 1, period_max: 2, tariff_code: 136 });
    const calc = new Calculator(m);
    const res = await calc.calculate({
      to: { code: 137 },
      packages: [{ weight: 500 }],
      tariffCode: 136,
    });
    expect(res.deliverySum).toBe('0.00');
    expect(res.tariffCode).toBe(136);
  });

  it('строковая цена "450.00" по-прежнему маппится корректно', async () => {
    const m = makeManager({ delivery_sum: '450.00', period_min: 1, period_max: 3, tariff_code: 136 });
    const calc = new Calculator(m);
    const res = await calc.calculate({
      to: { code: 137 },
      packages: [{ weight: 500 }],
      tariffCode: 136,
    });
    expect(res.deliverySum).toBe('450.00');
  });
});

// -----------------------------------------------------------------------------
// Фейковый manager с прямым vi.fn на client.request — позволяет проверять
// RequestOptions (бюджеты/idempotent), число вызовов (кеши) и диспетчеризацию
// по path (deliverypoints vs calculator) без прогона транспорта.
// -----------------------------------------------------------------------------

type RequestFn = (
  method: string,
  path: string,
  opts?: {
    query?: Record<string, unknown>;
    json?: Record<string, unknown>;
    timeoutMs?: number;
    maxNetworkRetries?: number;
    idempotent?: boolean;
  },
) => Promise<unknown>;

function makeFakeManager(
  cfg: ReturnType<typeof getCdekConfig>,
  impl: RequestFn,
): { manager: CdekManager; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(impl);
  const manager = {
    config: cfg,
    isMock: false,
    client: { request },
  } as unknown as CdekManager;
  return { manager, request };
}

const TARIFF_OK = { delivery_sum: 450, period_min: 1, period_max: 3, tariff_code: 136 };

/**
 * Аудит apidoc.cdek.ru 2026-07-09: в POST /v2/calculator/tarifflist поле `type`
 * означает 1 = «интернет-магазин» (default СДЭК), 2 = «доставка». Раньше дефолт
 * был 2 с комментарием «2 = ИМ» — расчёт списка шёл по чужому режиму договора.
 */
describe('cdek/calculator — tarifflist: дефолт type=1 (интернет-магазин)', () => {
  it('без input.type шлёт type: 1', async () => {
    const { manager, request } = makeFakeManager(realCfg, async () => ({ tariff_codes: [] }));
    await new Calculator(manager).calculateAvailable({ to: { code: 137 }, packages: [{ weight: 500 }] });
    const opts = request.mock.calls[0][2] as { json: { type: number } };
    expect(opts.json.type).toBe(1);
  });

  it('явный input.type=2 (доставка) проходит как есть', async () => {
    const { manager, request } = makeFakeManager(realCfg, async () => ({ tariff_codes: [] }));
    await new Calculator(manager).calculateAvailable({
      to: { code: 137 },
      packages: [{ weight: 500 }],
      type: 2,
    });
    const opts = request.mock.calls[0][2] as { json: { type: number } };
    expect(opts.json.type).toBe(2);
  });
});

/**
 * Расчёт от точки отгрузки (аудит 2026-07-09, medium): при заданном
 * CDEK_SHIPMENT_POINT котировка раньше всё равно шла от CDEK_FROM_LOCATION_CODE
 * (дефолт 44 Москва) — расхождение котировки и фактической накладной (создаётся
 * от ПВЗ отгрузки). Теперь real-ветка резолвит город ПВЗ через
 * GET /v2/deliverypoints?code=<point> (location.city_code), кеширует на 1 час и
 * подставляет его в from_location; при сбое — фоллбэк на fromLocationCode с
 * одним console.warn на ключ.
 */
describe('cdek/calculator — from_location от точки отгрузки (CDEK_SHIPMENT_POINT)', () => {
  const spCfg = getCdekConfig({
    NODE_ENV: 'test',
    CDEK_ACCOUNT: 'acc-1',
    CDEK_SECRET: 'sec-1',
    CDEK_BASE_URL: 'https://api.edu.cdek.ru',
    CDEK_SHIPMENT_POINT: 'NSK33',
    CDEK_FROM_LOCATION_CODE: '44',
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('резолвит город ПВЗ через GET /v2/deliverypoints?code=… и шлёт его в from_location', async () => {
    const { manager, request } = makeFakeManager(spCfg, async (_m, path) => {
      if (path === '/v2/deliverypoints') {
        return [{ code: 'NSK33', location: { city_code: 270 } }];
      }
      return TARIFF_OK;
    });
    await new Calculator(manager).calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });

    const [dpMethod, dpPath, dpOpts] = request.mock.calls[0] as [string, string, { query: Record<string, unknown> }];
    expect(dpMethod).toBe('GET');
    expect(dpPath).toBe('/v2/deliverypoints');
    expect(dpOpts.query.code).toBe('NSK33');

    const calcOpts = request.mock.calls[1][2] as { json: { from_location: { code: number } } };
    expect(calcOpts.json.from_location.code).toBe(270);
  });

  it('код города ПВЗ кешируется в памяти модуля: второй расчёт не дёргает deliverypoints', async () => {
    const { manager, request } = makeFakeManager(spCfg, async (_m, path) => {
      if (path === '/v2/deliverypoints') {
        return [{ code: 'NSK33', location: { city_code: 270 } }];
      }
      return TARIFF_OK;
    });
    const calc = new Calculator(manager);
    await calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    await calc.calculate({ to: { code: 137 }, packages: [{ weight: 900 }], tariffCode: 136 });

    const dpCalls = request.mock.calls.filter(([, path]) => path === '/v2/deliverypoints');
    expect(dpCalls).toHaveLength(1);
  });

  /** Warn'ы фоллбэка ПВЗ отгрузки (не считаем несвязанный warn token-store о памяти). */
  function shipmentWarns(warn: ReturnType<typeof vi.spyOn>): unknown[][] {
    return warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('ПВЗ отгрузки'));
  }

  it('сбой резолва ПВЗ → фоллбэк на fromLocationCode + ровно один console.warn на ключ', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, request } = makeFakeManager(spCfg, async (_m, path) => {
      if (path === '/v2/deliverypoints') {
        throw new CdekError('cdek_http_error', 'HTTP 500');
      }
      return TARIFF_OK;
    });
    const calc = new Calculator(manager);
    await calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    await calc.calculate({ to: { code: 137 }, packages: [{ weight: 900 }], tariffCode: 136 });

    const calcCalls = request.mock.calls.filter(([, path]) => path === '/v2/calculator/tariff');
    for (const call of calcCalls) {
      const opts = call[2] as { json: { from_location: { code: number } } };
      expect(opts.json.from_location.code).toBe(44); // фоллбэк, не падение расчёта
    }
    expect(shipmentWarns(warn)).toHaveLength(1); // один warn на ключ ПВЗ, без спама
  });

  it('ответ deliverypoints без location.city_code → фоллбэк на fromLocationCode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, request } = makeFakeManager(spCfg, async (_m, path) => {
      if (path === '/v2/deliverypoints') return [{ code: 'NSK33' }];
      return TARIFF_OK;
    });
    await new Calculator(manager).calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    const opts = request.mock.calls[1][2] as { json: { from_location: { code: number } } };
    expect(opts.json.from_location.code).toBe(44);
    expect(shipmentWarns(warn)).toHaveLength(1);
  });

  it('CDEK_SHIPMENT_POINT не задан → deliverypoints не запрашивается, from = fromLocationCode', async () => {
    const { manager, request } = makeFakeManager(realCfg, async () => TARIFF_OK);
    await new Calculator(manager).calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    expect(request).toHaveBeenCalledTimes(1);
    const opts = request.mock.calls[0][2] as { json: { from_location: { code: number } } };
    expect(opts.json.from_location.code).toBe(realCfg.fromLocationCode);
  });
});

/**
 * Кеш котировок + бюджеты витринного пути (переход в бой, low): каждый
 * чекаут-запрос бил живой POST /v2/calculator/tariff с timeoutMs=30000 при
 * лимите СДЭК 200 RPS на всех. Теперь real-ветка кеширует результат на 300с
 * (ключ — hash от контура+from+to+tariff+packages) и шлёт запрос с бюджетами
 * timeoutMs=10000, maxNetworkRetries=1, idempotent=true (расчёт безопасен к
 * повтору). Mock-ветка мгновенная — кеш не применяется.
 */
describe('cdek/calculator — кеш котировок (real, TTL 300с) и бюджеты запроса', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('передаёт витринные бюджеты: timeoutMs=10000, maxNetworkRetries=1, idempotent=true (tariff)', async () => {
    const { manager, request } = makeFakeManager(realCfg, async () => TARIFF_OK);
    await new Calculator(manager).calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    const opts = request.mock.calls[0][2] as {
      timeoutMs: number;
      maxNetworkRetries: number;
      idempotent: boolean;
    };
    expect(opts.timeoutMs).toBe(10_000);
    expect(opts.maxNetworkRetries).toBe(1);
    expect(opts.idempotent).toBe(true);
  });

  it('tarifflist тоже идёт с бюджетами и idempotent=true', async () => {
    const { manager, request } = makeFakeManager(realCfg, async () => ({ tariff_codes: [] }));
    await new Calculator(manager).calculateAvailable({ to: { code: 137 }, packages: [{ weight: 500 }] });
    const opts = request.mock.calls[0][2] as {
      timeoutMs: number;
      maxNetworkRetries: number;
      idempotent: boolean;
    };
    expect(opts.timeoutMs).toBe(10_000);
    expect(opts.maxNetworkRetries).toBe(1);
    expect(opts.idempotent).toBe(true);
  });

  it('повторный расчёт с теми же входами берётся из кеша (один POST к СДЭК)', async () => {
    const { manager, request } = makeFakeManager(realCfg, async () => TARIFF_OK);
    const calc = new Calculator(manager);
    const a = await calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    const b = await calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a); // тот же результат из кеша
  });

  it('другие входы (вес/город/тариф) → отдельный ключ кеша, новый запрос', async () => {
    const { manager, request } = makeFakeManager(realCfg, async () => TARIFF_OK);
    const calc = new Calculator(manager);
    await calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    await calc.calculate({ to: { code: 137 }, packages: [{ weight: 900 }], tariffCode: 136 });
    await calc.calculate({ to: { code: 44 }, packages: [{ weight: 500 }], tariffCode: 136 });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('кеш истекает по TTL 300с — после истечения новый запрос к СДЭК', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-09T12:00:00Z'));
    const { manager, request } = makeFakeManager(realCfg, async () => TARIFF_OK);
    const calc = new Calculator(manager);

    await calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    vi.setSystemTime(new Date('2026-07-09T12:04:00Z')); // 240с < 300с — ещё живой
    await calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    expect(request).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-07-09T12:05:01Z')); // 301с > 300с — истёк
    await calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('«тариф недоступен» (cdek_calc_no_price) НЕ кешируется — следующий вызов снова спрашивает СДЭК', async () => {
    let calls = 0;
    const { manager, request } = makeFakeManager(realCfg, async () => {
      calls += 1;
      if (calls === 1) return { errors: [{ code: 'v2_no_tariff', message: 'нет тарифа' }] };
      return TARIFF_OK;
    });
    const calc = new Calculator(manager);
    await expect(
      calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 }),
    ).rejects.toMatchObject({ code: 'cdek_calc_no_price' });
    const res = await calc.calculate({ to: { code: 137 }, packages: [{ weight: 500 }], tariffCode: 136 });
    expect(res.deliverySum).toBe('450.00');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
