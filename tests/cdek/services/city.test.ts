import { describe, it, expect, vi } from 'vitest';
import { CdekManager } from '@/lib/cdek/manager';
import { getCdekConfig } from '@/lib/cdek/config';
import { CityService } from '@/lib/cdek/services/city';

/**
 * Тесты CityService (поиск городов СДЭК, docs/13 §2). Mock-путь — фикстуры.
 * Real-путь — замоканный manager.client (без сети): автокомплит идёт через
 * GET /v2/location/suggest/cities (аудит apidoc.cdek.ru 2026-07-09): параметр
 * `city` у /v2/location/cities — ТОЧНОЕ совпадение названия, подстрока вернёт
 * пусто; для подсказок по неполному имени СДЭК даёт suggest/cities с ответом
 * [{ city_uuid, code, full_name }]. DTO витрины сохраняется: { code, name,
 * region } (name/region — из full_name «Город, Регион, Россия»).
 */

const mockCfg = getCdekConfig({ NODE_ENV: 'test' });
const realCfg = getCdekConfig({
  NODE_ENV: 'test',
  CDEK_ACCOUNT: 'acc-1',
  CDEK_SECRET: 'sec-1',
  CDEK_BASE_URL: 'https://api.edu.cdek.ru',
});

describe('cdek/city — mock-путь (фикстуры)', () => {
  const svc = new CityService(new CdekManager({ config: mockCfg }));

  it('находит Москву по подстроке', async () => {
    const cities = await svc.searchCities('моск');
    expect(cities.length).toBeGreaterThan(0);
    expect(cities[0]).toMatchObject({ code: 44, name: 'Москва' });
  });

  it('регистронезависимо', async () => {
    const cities = await svc.searchCities('САНКТ');
    expect(cities.some((c) => c.code === 137)).toBe(true);
  });

  it('короткий запрос (<2) → пусто', async () => {
    expect(await svc.searchCities('м')).toEqual([]);
    expect(await svc.searchCities('')).toEqual([]);
    expect(await svc.searchCities('  ')).toEqual([]);
  });

  it('нет фикстурного совпадения → один синтетический город (демо-fallback, не тупик чекаута)', async () => {
    // mock-режим (нет ключей СДЭК): город вне фикстур не должен давать пустой
    // автокомплит — иначе нельзя выбрать город → недостижимы ПВЗ/расчёт (#12).
    const cities = await svc.searchCities('Зззнетово');
    expect(cities.length).toBe(1);
    expect(cities[0]!.code).toBeGreaterThanOrEqual(1_000_000);
    expect(cities[0]!.name).toMatch(/Зззнетово/i);
  });
});

describe('cdek/city — real-путь (замоканный manager.client, suggest/cities)', () => {
  function makeManager(responseBody: unknown) {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    const tokenCache = { getToken: vi.fn(async () => 'tok-X'), invalidate: vi.fn(async () => {}) };
    return { m: new CdekManager({ config: realCfg, fetchImpl, tokenCache }), fetchImpl };
  }

  const rawSuggest = {
    city_uuid: '01581370-81f3-4322-9a28-3418adfabd97',
    code: 270,
    full_name: 'Новосибирск, Новосибирская область, Россия',
  };

  it('идёт в GET /v2/location/suggest/cities с name, БЕЗ country_code (поиск по всем странам — СНГ)', async () => {
    const { m, fetchImpl } = makeManager([rawSuggest]);
    await new CityService(m).searchCities('новос');
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = new URL(String(url));
    // /v2/location/cities?city=… — ТОЧНОЕ совпадение имени: автокомплит по
    // подстроке возвращал пусто (аудит 2026-07-09). Подсказки — suggest/cities.
    expect(parsed.pathname).toBe('/v2/location/suggest/cities');
    expect(parsed.searchParams.get('name')).toBe('новос');
    // country_code НЕ передаём — иначе СДЭК ограничил бы поиск только РФ и города
    // СНГ (Казахстан/Беларусь/…) были бы недоступны (владелец: доставка в СНГ).
    expect(parsed.searchParams.get('country_code')).toBeNull();
  });

  it('маппит [{ city_uuid, code, full_name }] → DTO { code, name, region } витрины', async () => {
    const { m } = makeManager([rawSuggest]);
    const cities = await new CityService(m).searchCities('новос');
    expect(cities).toEqual([
      { code: 270, name: 'Новосибирск', region: 'Новосибирская область', country: 'Россия' },
    ]);
  });

  it('full_name без региона («Город, Россия») → region пустой', async () => {
    const { m } = makeManager([
      { city_uuid: 'u-1', code: 44, full_name: 'Москва, Россия' },
    ]);
    const cities = await new CityService(m).searchCities('моск');
    expect(cities).toEqual([{ code: 44, name: 'Москва', region: '', country: 'Россия' }]);
  });

  it('full_name без запятых → name как есть, region пустой', async () => {
    const { m } = makeManager([{ city_uuid: 'u-2', code: 44, full_name: 'Москва' }]);
    const cities = await new CityService(m).searchCities('моск');
    expect(cities).toEqual([{ code: 44, name: 'Москва', region: '', country: '' }]);
  });

  it('отбрасывает записи без числового code', async () => {
    const { m } = makeManager([
      { city_uuid: 'u-3', full_name: 'Безкода, Россия' },
      rawSuggest,
    ]);
    const cities = await new CityService(m).searchCities('абвгд');
    expect(cities).toEqual([
      { code: 270, name: 'Новосибирск', region: 'Новосибирская область', country: 'Россия' },
    ]);
  });

  it('ограничивает результат limit (suggest не принимает size — режем сами)', async () => {
    const { m } = makeManager([
      { city_uuid: 'u-a', code: 1, full_name: 'А, Регион, Россия' },
      { city_uuid: 'u-b', code: 2, full_name: 'Б, Регион, Россия' },
      { city_uuid: 'u-c', code: 3, full_name: 'В, Регион, Россия' },
    ]);
    const cities = await new CityService(m).searchCities('абвгд', 2);
    expect(cities.map((c) => c.code)).toEqual([1, 2]);
  });

  it('устойчив к не-массиву в ответе', async () => {
    const { m } = makeManager({ unexpected: true });
    expect(await new CityService(m).searchCities('абвгд')).toEqual([]);
  });
});
