/**
 * Calculator — расчёт стоимости/срока доставки СДЭК (docs/08 §5, порт carre
 * Calculator.php).
 *
 * Выбор источника данных — по getCdekManager().isMock (docs/08 §11):
 *   • isMock → mock-функции (формула §5.3, lib/cdek/mock);
 *   • иначе  → manager.client.request к /v2/calculator/{tariff,tarifflist} с
 *             маппингом snake_case ответа СДЭК в доменный CdekTariffResult.
 *
 * from_location — ВСЕГДА серверный (CdekConfig.fromLocationCode / shipmentPoint),
 * из входа не берётся (анти-tamper, docs/08 §6.1, ADR-010).
 *
 * Хелпер aggregatePackage — чистая агрегация веса/габаритов корзины в одну
 * упаковку (вес/высота — Σ(qty*x), Д/Ш — max), тестируется без сети.
 */

import type { CdekManager } from '../manager';
import {
  CDEK_FALLBACK_DIMENSIONS,
  type CdekConfig,
} from '../config';
import type {
  CdekLocation,
  CdekPackage,
  CdekTariffOption,
  CdekTariffResult,
  PackageDims,
} from '../types';

// -----------------------------------------------------------------------------
// Агрегация корзины в упаковку (чистая функция).
// -----------------------------------------------------------------------------

/**
 * Позиция корзины с (опциональными) габаритами товара/варианта (миграция 0018).
 * null/undefined → дефолт магазина. Вес варианта переопределяет вес товара —
 * это решает вызывающий, передавая итоговые weightG/… на позицию.
 */
export interface CartLineDims {
  qty: number;
  weightG?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

/**
 * Агрегирует позиции корзины в одну упаковку СДЭК (docs/08 §7.1 packages):
 *   weight = Σ(weightG × qty); length/width = max; height = Σ(heightG × qty).
 * Пустые/NULL поля позиции → дефолт магазина (defaults) → фоллбэк последней
 * инстанции (CDEK_FALLBACK_DIMENSIONS). Пустая корзина → одна дефолтная упаковка.
 * Чистая, детерминированная.
 */
export function aggregatePackage(
  lines: readonly CartLineDims[],
  defaults: PackageDims = CDEK_FALLBACK_DIMENSIONS,
): CdekPackage {
  if (lines.length === 0) {
    return {
      weight: defaults.weightG,
      length: defaults.lengthCm,
      width: defaults.widthCm,
      height: defaults.heightCm,
    };
  }

  let weight = 0;
  let length = 0;
  let width = 0;
  let height = 0;

  for (const line of lines) {
    const qty = Math.max(1, line.qty || 1);
    const w = line.weightG ?? defaults.weightG;
    const l = line.lengthCm ?? defaults.lengthCm;
    const wd = line.widthCm ?? defaults.widthCm;
    const h = line.heightCm ?? defaults.heightCm;

    weight += w * qty;
    height += h * qty;
    length = Math.max(length, l);
    width = Math.max(width, wd);
  }

  return { weight, length, width, height };
}

// -----------------------------------------------------------------------------
// Вход расчёта.
// -----------------------------------------------------------------------------

/** Вход расчёта по конкретному тарифу. */
export interface CalculateInput {
  /** Назначение: код города / индекс / адрес. */
  to: CdekLocation;
  /** Готовые упаковки (если уже агрегированы вызывающим). */
  packages?: CdekPackage[];
  /** ИЛИ позиции корзины — будут агрегированы в одну упаковку. */
  lines?: readonly CartLineDims[];
  /** Код тарифа; дефолт — CdekConfig.defaultTariffCode. */
  tariffCode?: number;
}

/** Вход расчёта списка доступных тарифов. */
export interface CalculateAvailableInput {
  to: CdekLocation;
  packages?: CdekPackage[];
  lines?: readonly CartLineDims[];
  /** type для tarifflist (2 = ИМ). */
  type?: number;
}

// -----------------------------------------------------------------------------
// Маппинг snake_case ответа СДЭК → домен.
// -----------------------------------------------------------------------------

/** Деньги из ответа СДЭК (число/строка) → строка NUMERIC(14,2). */
function toMoney(v: unknown): string {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0;
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function mapTariffResult(raw: Record<string, unknown>, tariffCode: number): CdekTariffResult {
  return {
    deliverySum: toMoney(raw.delivery_sum ?? raw.total_sum),
    periodMin: toIntOrNull(raw.period_min),
    periodMax: toIntOrNull(raw.period_max),
    tariffCode: toIntOrNull(raw.tariff_code) ?? tariffCode,
  };
}

function mapTariffOption(raw: Record<string, unknown>): CdekTariffOption {
  return {
    tariffCode: toIntOrNull(raw.tariff_code) ?? 0,
    tariffName: typeof raw.tariff_name === 'string' ? raw.tariff_name : null,
    deliverySum: toMoney(raw.delivery_sum ?? raw.total_sum),
    periodMin: toIntOrNull(raw.period_min),
    periodMax: toIntOrNull(raw.period_max),
    deliveryMode: toIntOrNull(raw.delivery_mode),
  };
}

// -----------------------------------------------------------------------------
// Calculator.
// -----------------------------------------------------------------------------

export class Calculator {
  constructor(private readonly manager: CdekManager) {}

  private get config(): CdekConfig {
    return this.manager.config;
  }

  /** Серверная локация отправления (анти-tamper). */
  private fromLocation(): CdekLocation {
    return { code: this.config.fromLocationCode };
  }

  /** packages из входа: явные packages ИЛИ агрегация позиций корзины. */
  private resolvePackages(input: { packages?: CdekPackage[]; lines?: readonly CartLineDims[] }): CdekPackage[] {
    if (input.packages && input.packages.length > 0) return input.packages;
    if (input.lines) return [aggregatePackage(input.lines, this.config.defaultDimensions)];
    return [aggregatePackage([], this.config.defaultDimensions)];
  }

  /**
   * Расчёт по конкретному тарифу (POST /v2/calculator/tariff).
   * В mock — формула §5.3; в real — запрос + маппинг ответа.
   */
  async calculate(input: CalculateInput): Promise<CdekTariffResult> {
    const tariffCode = input.tariffCode ?? this.config.defaultTariffCode;
    const packages = this.resolvePackages(input);

    if (this.manager.isMock) {
      return this.manager.mock.mockCalculateByTariff(tariffCode, packages);
    }

    const raw = await this.manager.client.request<Record<string, unknown>>(
      'POST',
      '/v2/calculator/tariff',
      {
        json: {
          tariff_code: tariffCode,
          from_location: this.fromLocation(),
          to_location: toApiLocation(input.to),
          packages,
        },
      },
    );
    return mapTariffResult(raw ?? {}, tariffCode);
  }

  /**
   * Список доступных тарифов (POST /v2/calculator/tarifflist, type=2 ИМ).
   * В mock — фикстурный набор; в real — запрос + маппинг tariff_codes[].
   */
  async calculateAvailable(input: CalculateAvailableInput): Promise<CdekTariffOption[]> {
    const packages = this.resolvePackages(input);

    if (this.manager.isMock) {
      return this.manager.mock.mockCalculateAvailable(packages);
    }

    const raw = await this.manager.client.request<Record<string, unknown>>(
      'POST',
      '/v2/calculator/tarifflist',
      {
        json: {
          type: input.type ?? 2,
          from_location: this.fromLocation(),
          to_location: toApiLocation(input.to),
          packages,
        },
      },
    );
    const list = Array.isArray(raw?.tariff_codes) ? (raw.tariff_codes as Record<string, unknown>[]) : [];
    return list.map(mapTariffOption);
  }
}

/** Доменная локация → snake_case тело СДЭК (отбрасывает undefined). */
function toApiLocation(loc: CdekLocation): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (loc.code !== undefined) out.code = loc.code;
  if (loc.postalCode !== undefined) out.postal_code = loc.postalCode;
  if (loc.address !== undefined) out.address = loc.address;
  return out;
}
