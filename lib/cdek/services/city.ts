/**
 * CityService — поиск городов СДЭК для автокомплита витрины.
 *
 * Выбор источника — по getCdekManager().isMock (как PvzService, docs/08 §11):
 *   • isMock → фикстуры (lib/cdek/mock.mockSearchCities);
 *   • иначе  → GET /v2/location/suggest/cities (аудит apidoc.cdek.ru
 *     2026-07-09): у GET /v2/location/cities параметр `city` — ТОЧНОЕ
 *     совпадение названия, автокомплит по подстроке возвращал пусто. Метод
 *     подсказок suggest/cities принимает неполное имя (`name`) и отдаёт массив
 *     { city_uuid, code, full_name }.
 *
 * Витрине нужен code города (для расчёта доставки и списка ПВЗ), name и region
 * для отображения в выпадашке (DTO сохранён — форма mock-ветки/AdmikCdekCityDto).
 * name/region выводятся из full_name вида «Город, Регион, Россия»: name —
 * первая часть, region — середина (для «Город, Россия» — пустая строка).
 * Ключи СДЭК на фронт не утекают (прокси-роут).
 */

import type { CdekManager } from '../manager';
import type { CdekCity } from '../types';

/** Сырое тело подсказки из ответа СДЭК /v2/location/suggest/cities. */
interface RawSuggestCity {
  city_uuid?: unknown;
  code?: unknown;
  full_name?: unknown;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Маппинг подсказки suggest/cities → доменный CdekCity (отбрасывает записи без
 * числового code — он обязателен витрине для расчёта/ПВЗ). suggest не отдаёт
 * region отдельным полем — берём его из full_name: первая часть — город,
 * последняя — страна, середина — регион (пусто, если формата «Город, Россия»).
 */
function mapSuggestCity(raw: RawSuggestCity): CdekCity | null {
  const code = asNumberOrNull(raw.code);
  if (code === null) return null;
  const parts = asString(raw.full_name)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return {
    code,
    name: parts[0] ?? '',
    region: parts.length >= 3 ? parts.slice(1, -1).join(', ') : '',
  };
}

export class CityService {
  constructor(private readonly manager: CdekManager) {}

  /**
   * Поиск городов по подстроке имени. В mock — фикстуры; в real — GET
   * /v2/location/suggest/cities?name=…&country_code=RU с маппингом. Пустой/
   * короткий запрос (<2 символов) → пустой список (как mock). Устойчив к
   * не-массиву. suggest не принимает size — режем результат по limit сами.
   */
  async searchCities(query: string, limit = 10): Promise<CdekCity[]> {
    const q = (query ?? '').trim();
    if (q.length < 2) return [];

    if (this.manager.isMock) {
      return this.manager.mock.mockSearchCities(q);
    }

    const raw = await this.manager.client.request<unknown>(
      'GET',
      '/v2/location/suggest/cities',
      {
        query: { name: q, country_code: 'RU' },
      },
    );
    if (!Array.isArray(raw)) return [];
    return (raw as RawSuggestCity[])
      .map(mapSuggestCity)
      .filter((c): c is CdekCity => c !== null)
      .slice(0, Math.max(1, limit));
  }
}
