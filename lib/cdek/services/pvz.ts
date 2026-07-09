/**
 * PvzService — пункты выдачи заказов СДЭК (docs/08 §6, порт carre PvzService.php;
 * боевой контракт — аудит apidoc.cdek.ru deliverypoints 2026-07-09).
 *
 * Выбор источника — по getCdekManager().isMock (docs/08 §11):
 *   • isMock → фикстуры (lib/cdek/mock);
 *   • иначе  → manager.client.request к GET /v2/deliverypoints + маппинг ответа
 *             (СДЭК возвращает массив сырых офисов) в доменный CdekOffice.
 *
 * REAL-ветка listOffices (аудит перехода в бой):
 *   • ПАГИНАЦИЯ: явные size/page (size=1000 — дефолт СДЭК для location-методов)
 *     с добором страниц до неполной/пустой, кап PVZ_MAX_PAGES. Раньше опора на
 *     недокументированное «без size вернётся всё» — риск обрезки в мегаполисах.
 *   • ФИЛЬТР is_handout: витрина показывает ПВЗ для ВЫДАЧИ заказа покупателю;
 *     офисы только-приёма (is_handout === false) отбрасываются. Отсутствие поля
 *     трактуется как «выдающий» (не отфильтровать всё при смене схемы ответа).
 *   • КЕШ списка: СДЭК рекомендует не хранить статичный список и обновлять кэш
 *     раз в сутки (общий лимит 200 RPS) — без кеша каждый запрос витрины бил
 *     живой API. Ключ — контур (baseUrl) + канонизированные фильтры; TTL 6ч
 *     (PVZ_LIST_CACHE_TTL_SEC). Хранилище — переиспользуем TokenStore из
 *     token-cache.ts (Redis при REDIS_URL, иначе память процесса; паттерн
 *     rate-limit.ts) с деградацией в module-level in-memory Map при недоступном
 *     Redis (ошибка store не валит запрос витрины и не выключает кеширование).
 *     Кеш ТОЛЬКО в real-ветке (mock-фикстуры детерминированы и бесплатны) и
 *     только для валидного ответа-массива (не-массив → [] БЕЗ записи в кеш,
 *     чтобы 6 часов не отдавать пустоту из-за одного битого ответа).
 *   • ВЕС: weightGrams (граммы — конвенция витрины, как weightG в calculate)
 *     конвертируется в КГ-фильтры СДЭК weight_max/weight_min (int ≥0, кг).
 *     Консервативно: weight_max = ceil(кг) — офис обязан принимать НЕ МЕНЬШЕ
 *     веса посылки (floor давал бы офисы, неспособные принять посылку);
 *     weight_min = floor(кг) и только при >0 (иначе фильтр не передаётся).
 */

import type { CdekManager } from '../manager';
import type { CdekOffice } from '../types';
import {
  MemoryTokenStore,
  getDefaultTokenStore,
  type TokenStore,
} from '../token-cache';

/** Фильтры списка ПВЗ (docs/08 §6.3 + фильтр веса, apidoc deliverypoints). */
export interface ListOfficesInput {
  cityCode?: number;
  postalCode?: string;
  type?: string; // PVZ | POSTAMAT
  countryCode?: string;
  /**
   * Вес посылки в ГРАММАХ (конвенция витрины). В real-ветке конвертируется в
   * кг-фильтры СДЭК weight_max/weight_min (см. шапку). Mock-ветка игнорирует.
   */
  weightGrams?: number;
}

/** TTL кеша списка ПВЗ, сек (6ч; СДЭК рекомендует обновление не чаще суток). */
export const PVZ_LIST_CACHE_TTL_SEC = 6 * 60 * 60;

/** Размер страницы /v2/deliverypoints (дефолт СДЭК для location-методов). */
export const PVZ_PAGE_SIZE = 1000;

/** Кап страниц добора (10 × 1000 офисов — с запасом для любого мегаполиса). */
export const PVZ_MAX_PAGES = 10;

/** Сырое тело офиса из ответа СДЭК /v2/deliverypoints. */
interface RawOffice {
  code?: unknown;
  name?: unknown;
  type?: unknown;
  work_time?: unknown;
  /** true/отсутствует — офис выдаёт заказы; false — только приём (отбрасываем). */
  is_handout?: unknown;
  location?: {
    address_full?: unknown;
    address?: unknown;
    city_code?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  };
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Маппинг сырого офиса СДЭК → доменный CdekOffice. */
function mapOffice(raw: RawOffice): CdekOffice {
  const loc = raw.location ?? {};
  const lat = asNumberOrNull(loc.latitude);
  const lon = asNumberOrNull(loc.longitude);
  return {
    code: asString(raw.code),
    name: asString(raw.name),
    address: asString(loc.address_full ?? loc.address),
    type: asString(raw.type) || 'PVZ',
    cityCode: asNumberOrNull(loc.city_code),
    location: lat !== null && lon !== null ? { latitude: lat, longitude: lon } : null,
    workTime: typeof raw.work_time === 'string' ? raw.work_time : null,
  };
}

/**
 * Выдаёт ли офис заказы покупателю. Только литеральный `false` отбраковывает
 * (строгая проверка: отсутствие/мутация схемы не должны опустошить список).
 */
function isHandoutCapable(raw: RawOffice): boolean {
  return raw.is_handout !== false;
}

/**
 * Ключ кеша списка ПВЗ: контур (baseUrl — edu и prod НЕ делят кеш, наборы
 * офисов у контуров разные) + канонизированные фильтры в фиксированном порядке.
 */
export function pvzListCacheKey(baseUrl: string, input: ListOfficesInput): string {
  const parts: string[] = [];
  if (input.cityCode !== undefined) parts.push(`city_code=${input.cityCode}`);
  if (input.postalCode !== undefined) parts.push(`postal_code=${input.postalCode}`);
  if (input.type !== undefined) parts.push(`type=${input.type}`);
  if (input.countryCode !== undefined) parts.push(`country_code=${input.countryCode}`);
  if (input.weightGrams !== undefined) parts.push(`weight_g=${input.weightGrams}`);
  return `cdek:pvz:list:${baseUrl}|${parts.join('&')}`;
}

// ---------------------------------------------------------------------------
// Fallback-кеш процесса на случай недоступного Redis-store. Module-level,
// потому что роут создаёт PvzService на каждый запрос — per-instance Map был бы
// всегда холодным. Redis снова доступен → primary-store берёт верх сам собой
// (fallback опрашивается только после ошибки primary).
// ---------------------------------------------------------------------------

let cacheFallback: MemoryTokenStore | null = null;

function getCacheFallback(): MemoryTokenStore {
  if (!cacheFallback) cacheFallback = new MemoryTokenStore();
  return cacheFallback;
}

/** Только для тестов: сброс module-level fallback-кеша. */
export function __resetPvzCacheFallbackForTests(): void {
  cacheFallback = null;
}

/** Опции сервиса (тесты: изоляция кеша; прод — дефолты). */
export interface PvzServiceOptions {
  /** Хранилище кеша списка. Дефолт — getDefaultTokenStore() (Redis|память). */
  cacheStore?: TokenStore;
  /** TTL кеша списка, сек. Дефолт PVZ_LIST_CACHE_TTL_SEC (6ч). */
  cacheTtlSec?: number;
}

export class PvzService {
  private readonly cacheTtlSec: number;
  private readonly cacheStore?: TokenStore;

  constructor(
    private readonly manager: CdekManager,
    opts: PvzServiceOptions = {},
  ) {
    this.cacheStore = opts.cacheStore;
    this.cacheTtlSec = opts.cacheTtlSec ?? PVZ_LIST_CACHE_TTL_SEC;
  }

  /**
   * Список ПВЗ по городу/индексу/типу/весу. В mock — фикстуры с фильтром (без
   * кеша); в real — кеш (TTL 6ч) → GET /v2/deliverypoints с явной пагинацией
   * size/page → фильтр is_handout → маппинг. Устойчив к не-массиву в ответе
   * (→ [] без записи в кеш).
   */
  async listOffices(input: ListOfficesInput = {}): Promise<CdekOffice[]> {
    if (this.manager.isMock) {
      return this.manager.mock.mockGetOffices({
        cityCode: input.cityCode,
        type: input.type,
      });
    }

    const key = pvzListCacheKey(this.manager.config.baseUrl, input);
    const cached = await this.cacheGet(key);
    if (cached !== null) return cached;

    const raws = await this.fetchAllPages(input);
    if (raws === null) return []; // первая страница не-массив — не кешируем
    const offices = raws.filter(isHandoutCapable).map(mapOffice);
    await this.cacheSet(key, offices);
    return offices;
  }

  /**
   * Поиск ПВЗ по коду. Пустой код → null. В mock — поиск в фикстурах; в real —
   * GET /v2/deliverypoints?code=… → первый элемент или null (без кеша: точечный
   * вызов чекаута, СДЭК возвращает 0/1 офис).
   */
  async findOffice(code: string): Promise<CdekOffice | null> {
    const trimmed = (code ?? '').trim();
    if (trimmed === '') return null;

    if (this.manager.isMock) {
      return this.manager.mock.mockFindOfficeByCode(trimmed);
    }

    const raw = await this.manager.client.request<unknown>('GET', '/v2/deliverypoints', {
      query: { code: trimmed },
    });
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return mapOffice(raw[0] as RawOffice);
  }

  // -------------------------------------------------------------------------
  // Пагинация.
  // -------------------------------------------------------------------------

  /** Query-фильтры СДЭК из входа (без size/page — их добавляет пагинатор). */
  private buildQuery(input: ListOfficesInput): Record<string, string | number> {
    const query: Record<string, string | number> = {};
    if (input.cityCode !== undefined) query.city_code = input.cityCode;
    if (input.postalCode !== undefined) query.postal_code = input.postalCode;
    if (input.type !== undefined) query.type = input.type;
    if (input.countryCode !== undefined) query.country_code = input.countryCode;
    if (input.weightGrams !== undefined && input.weightGrams > 0) {
      const kg = input.weightGrams / 1000;
      // ceil: офис обязан принимать НЕ МЕНЬШЕ веса посылки (см. шапку).
      query.weight_max = Math.max(1, Math.ceil(kg));
      const minKg = Math.floor(kg);
      if (minKg > 0) query.weight_min = minKg;
    }
    return query;
  }

  /**
   * Добор всех страниц /v2/deliverypoints (size=PVZ_PAGE_SIZE, page=0..).
   *
   * ВАЖНО (боевой аудит 2026-07-09, находка #1): в отличие от /v2/location/cities,
   * эндпоинт /v2/deliverypoints НЕ пагинирует size/page — он отдаёт ВЕСЬ
   * отфильтрованный список за один ответ (модель СДЭК: скачать полный справочник и
   * кешировать). При size≥числа офисов города апстрим повторяет тот же полный
   * список на КАЖДОЙ странице → в мегаполисах (Москва >1000 ПВЗ) без дедупа
   * получались N-кратные дубли, закешированные на 6ч. Поэтому: дедуп по коду офиса
   * + остановка, как только страница НЕ добавила новых кодов (page проигнорирован).
   * size/page шлём защитно — если СДЭК всё же начнёт пагинировать, добор корректен.
   *
   * Остановка: страница без новых кодов, неполная/пустая страница или кап
   * PVZ_MAX_PAGES. Возвращает null, если ПЕРВАЯ страница — не массив (битый ответ;
   * не кешировать); не-массив на продолжении завершает добор с уже накопленным.
   */
  private async fetchAllPages(input: ListOfficesInput): Promise<RawOffice[] | null> {
    const baseQuery = this.buildQuery(input);
    const all: RawOffice[] = [];
    const seenCodes = new Set<string>();
    for (let page = 0; page < PVZ_MAX_PAGES; page++) {
      const raw = await this.manager.client.request<unknown>('GET', '/v2/deliverypoints', {
        query: { ...baseQuery, size: PVZ_PAGE_SIZE, page },
      });
      if (!Array.isArray(raw)) {
        if (page === 0) return null;
        break;
      }
      let added = 0;
      for (const office of raw as RawOffice[]) {
        const code = office.code != null ? String(office.code) : '';
        if (code !== '' && seenCodes.has(code)) continue;
        if (code !== '') seenCodes.add(code);
        all.push(office);
        added++;
      }
      // Нет новых кодов (page проигнорирован) или страница неполная → конец добора.
      if (added === 0 || raw.length < PVZ_PAGE_SIZE) break;
    }
    return all;
  }

  // -------------------------------------------------------------------------
  // Кеш (primary store → fallback-память процесса при ошибке primary).
  // -------------------------------------------------------------------------

  private store(): Promise<TokenStore> {
    return this.cacheStore ? Promise.resolve(this.cacheStore) : getDefaultTokenStore();
  }

  /** Чтение кеша; ошибки store/битый JSON → null (идём в сеть, не падаем). */
  private async cacheGet(key: string): Promise<CdekOffice[] | null> {
    let text: string | null = null;
    try {
      text = await (await this.store()).get(key);
    } catch {
      text = await getCacheFallback().get(key);
    }
    if (text === null) return null;
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? (parsed as CdekOffice[]) : null;
    } catch {
      return null;
    }
  }

  /** Запись кеша; при ошибке primary — fallback-память (кеш не выключается). */
  private async cacheSet(key: string, offices: CdekOffice[]): Promise<void> {
    const value = JSON.stringify(offices);
    try {
      await (await this.store()).set(key, value, this.cacheTtlSec);
    } catch {
      await getCacheFallback().set(key, value, this.cacheTtlSec);
    }
  }
}
