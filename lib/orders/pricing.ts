/**
 * Чистые функции серверного расчёта корзины (docs/07 §3.1–§3.3, ADR-010 anti-tamper).
 *
 * ИТОГ СЧИТАЕТ СЕРВЕР. Эти функции принимают УЖЕ нормализованные позиции с
 * ценами, ВЗЯТЫМИ ИЗ КАТАЛОГА вызывающим кодом (repository.quoteCart берёт
 * base_price/price_override/price_delta/compare_at_price из lib/catalog), и
 * проверенный промокод. Цена НИКОГДА не приходит из тела запроса витрины.
 *
 * Деньги — строки `NUMERIC(14,2)`; вся арифметика идёт в целых копейках
 * (lib/orders/money.ts) → нет ошибок float, корректное округление процентов.
 *
 * Порядок расчёта (детерминированный, §3.1):
 *   1) itemsTotal = Σ(unitPrice × qty), unitPrice — эффективная цена продажи
 *      (НЕ compare_at; «было» — только снимок для чека);
 *   2) discount  = скидка промокода (percent/fixed/free_delivery/bogo), ≤ itemsTotal;
 *   3) delivery  = стоимость доставки с учётом порога бесплатной доставки и
 *      промокода free_delivery (порог сравнивается с itemsTotal − discount);
 *   4) grandTotal = itemsTotal − discount + delivery (≥ 0).
 */

import { fromMinor, percentOfMinor, toMinor, type MoneyString } from './money';
import type { PromoKind } from './types';

// -----------------------------------------------------------------------------
// Вход.
// -----------------------------------------------------------------------------

/**
 * Нормализованная позиция корзины с ценами ИЗ КАТАЛОГА (anti-tamper: цену
 * подставляет сервер, не клиент). Все цены — строки NUMERIC(14,2).
 */
export interface PricedLine {
  /** Снимок названия товара/варианта (для order_items, ADR-010). */
  name: string;
  /** Снимок артикула. */
  sku: string;
  /** Эффективная цена продажи за единицу (что реально платят). */
  unitPrice: MoneyString;
  /** «Было» на момент покупки (compare_at); null → без каталожной акции. */
  compareAt: MoneyString | null;
  /** Количество, целое ≥ 1. */
  qty: number;
}

/**
 * Промокод, УЖЕ проверенный (validatePromo вернул valid=true) — pricing только
 * применяет его эффект к итогу. Для percent: value — проценты; для fixed: сумма;
 * для free_delivery: эффект на доставку; bogo — задел (§3.2, Этап 5.2).
 */
export interface AppliedPromo {
  code: string;
  kind: PromoKind;
  /** percent → проценты 0..100; fixed → сумма скидки; иначе игнор. */
  value: MoneyString;
  /** Потолок скидки (для percent); null → без потолка. */
  maxDiscount: MoneyString | null;
  /** Задел под bogo «N по M» (§3.2): «купи N». */
  bogoBuyQty: number | null;
  /** Задел под bogo: «плати за M». */
  bogoPayQty: number | null;
}

/** Параметры расчёта доставки (anti-tamper: cost — серверный, не из запроса). */
export interface DeliveryInput {
  /** Базовая стоимость доставки (СДЭК/заглушка); 0 при самовывозе. */
  cost: MoneyString;
  /** Порог бесплатной доставки (SHOP_FREE_DELIVERY_THRESHOLD); 0 = выключено. */
  freeThreshold: number;
}

/** Полный вход расчёта итога. */
export interface QuoteInput {
  lines: PricedLine[];
  promo?: AppliedPromo | null;
  delivery: DeliveryInput;
}

// -----------------------------------------------------------------------------
// Выход.
// -----------------------------------------------------------------------------

/** Деталь рассчитанной позиции (для ответа quote и снимка order_items). */
export interface QuoteLine {
  name: string;
  sku: string;
  unitPrice: MoneyString;
  compareAt: MoneyString | null;
  qty: number;
  /** = unitPrice × qty. */
  lineTotal: MoneyString;
}

/** Разбивка скидки промокода. */
export interface PromoBreakdown {
  applied: boolean;
  code: string | null;
  kind: PromoKind | null;
  /** Фактическая скидка промокода (для discount_total / promo_redemptions). */
  discount: MoneyString;
}

/** Разбивка доставки. */
export interface DeliveryBreakdown {
  /** Базовая (до бесплатности) стоимость. */
  baseCost: MoneyString;
  /** Итоговая стоимость доставки (0 при бесплатной/самовывозе). */
  cost: MoneyString;
  /** Доставка бесплатна (порог достигнут или промокод free_delivery). */
  free: boolean;
  /** Достигнут ли порог бесплатной доставки по сумме (без учёта промокода). */
  freeThresholdMet: boolean;
}

/** Итог расчёта корзины (серверный, anti-tamper). */
export interface QuoteResult {
  lines: QuoteLine[];
  /** Σ lineTotal. */
  itemsTotal: MoneyString;
  /** Скидка промокода (не доставка). */
  discount: MoneyString;
  /** Стоимость доставки. */
  deliveryCost: MoneyString;
  /** itemsTotal − discount + deliveryCost. */
  grandTotal: MoneyString;
  promo: PromoBreakdown;
  delivery: DeliveryBreakdown;
}

// -----------------------------------------------------------------------------
// Эффективная цена позиции из каталога (anti-tamper источник, §3.1).
// -----------------------------------------------------------------------------

/**
 * Эффективная цена ПРОДАЖИ за единицу в копейках (что реально платят):
 *  - вариант с price_override → price_override;
 *  - вариант без override → base_price + price_delta;
 *  - товар без варианта → base_price.
 *
 * Считается в целых копейках (без float). НЕ возвращает compare_at — «было»
 * берётся отдельно (effectiveCompareAt каталога) и идёт только в снимок чека.
 */
export function effectiveUnitPriceMinor(opts: {
  basePrice: MoneyString;
  priceOverride?: MoneyString | null;
  priceDelta?: MoneyString | null;
}): number {
  if (opts.priceOverride != null) {
    return toMinor(opts.priceOverride);
  }
  const base = toMinor(opts.basePrice);
  const delta = opts.priceDelta != null ? toMinor(opts.priceDelta) : 0;
  return base + delta;
}

// -----------------------------------------------------------------------------
// Расчёт позиции и суммы товаров.
// -----------------------------------------------------------------------------

/** Сумма позиции в копейках = unitPrice × qty (целочисленно). */
export function lineTotalMinor(line: PricedLine): number {
  if (!Number.isInteger(line.qty) || line.qty < 1) {
    throw new Error(`Некорректное количество позиции "${line.sku}": ${line.qty}.`);
  }
  return toMinor(line.unitPrice) * line.qty;
}

/** Сумма всех позиций в копейках. */
export function itemsTotalMinor(lines: PricedLine[]): number {
  return lines.reduce((acc, l) => acc + lineTotalMinor(l), 0);
}

// -----------------------------------------------------------------------------
// Применение промокода (поверх itemsTotal; §3.2). Чистая функция.
// -----------------------------------------------------------------------------

/**
 * Скидка промокода в копейках по itemsTotal (копейки). Не больше itemsTotal.
 *  - percent: round(itemsMinor × value/100), обрезано maxDiscount;
 *  - fixed:   min(value, itemsMinor);
 *  - free_delivery: 0 (эффект — на доставку, §3.3);
 *  - bogo: ЗАДЕЛ (§3.2) — расчёт «дешёвая бесплатно» отложен в Этап 5.2; здесь 0.
 */
export function promoDiscountMinor(
  promo: AppliedPromo | null | undefined,
  itemsMinor: number,
): number {
  if (!promo) return 0;

  let discount = 0;
  switch (promo.kind) {
    case 'percent': {
      const pct = Number(promo.value);
      discount = percentOfMinor(itemsMinor, pct);
      if (promo.maxDiscount != null) {
        discount = Math.min(discount, toMinor(promo.maxDiscount));
      }
      break;
    }
    case 'fixed': {
      discount = Math.min(toMinor(promo.value), itemsMinor);
      break;
    }
    case 'free_delivery': {
      // Скидки на товары нет — эффект применяется к доставке (§3.3).
      discount = 0;
      break;
    }
    case 'bogo': {
      // TODO(Этап 5.2): движок «N по M» — на каждые bogoBuyQty одинаковых
      // позиций бесплатна (bogoBuyQty − bogoPayQty) самых дешёвых (docs/07 §3.2).
      // Модель заложена (поля bogoBuyQty/bogoPayQty), исполнение отложено.
      discount = 0;
      break;
    }
  }
  // Скидка промокода не может превышать сумму товаров (§3.1.2).
  return Math.min(Math.max(0, discount), itemsMinor);
}

// -----------------------------------------------------------------------------
// Доставка и порог бесплатной доставки (§3.3). Чистая функция.
// -----------------------------------------------------------------------------

/**
 * Стоимость доставки в копейках с учётом порога и промокода free_delivery.
 * Порог сравнивается с суммой ПОСЛЕ скидки промокода (itemsMinor − discountMinor).
 * Возвращает разбивку: итоговая стоимость + признаки бесплатности.
 */
export function resolveDelivery(
  delivery: DeliveryInput,
  netItemsMinor: number,
  promo: AppliedPromo | null | undefined,
): { costMinor: number; free: boolean; freeThresholdMet: boolean } {
  const baseCostMinor = toMinor(delivery.cost);

  // Порог: 0 (или отрицательный) = выключено → никогда не «бесплатно по порогу».
  const thresholdMinor =
    delivery.freeThreshold > 0 ? toMinor(delivery.freeThreshold) : Number.POSITIVE_INFINITY;
  const freeThresholdMet =
    Number.isFinite(thresholdMinor) && netItemsMinor >= thresholdMinor;

  const promoFreeDelivery = promo?.kind === 'free_delivery';
  const free = freeThresholdMet || promoFreeDelivery;

  return {
    costMinor: free ? 0 : baseCostMinor,
    free,
    freeThresholdMet,
  };
}

// -----------------------------------------------------------------------------
// Полный расчёт итога (компонует всё выше). Чистая функция — anti-tamper ядро.
// -----------------------------------------------------------------------------

/**
 * Серверный расчёт корзины: позиции → товары → промокод → доставка → итог.
 * Полностью детерминированный и тестируемый без БД (матрица).
 */
export function calculateQuote(input: QuoteInput): QuoteResult {
  const { lines, promo, delivery } = input;

  // 1) Позиции и сумма товаров.
  const quoteLines: QuoteLine[] = lines.map((l) => {
    const ltMinor = lineTotalMinor(l);
    return {
      name: l.name,
      sku: l.sku,
      unitPrice: fromMinor(toMinor(l.unitPrice)),
      compareAt: l.compareAt != null ? fromMinor(toMinor(l.compareAt)) : null,
      qty: l.qty,
      lineTotal: fromMinor(ltMinor),
    };
  });
  const itemsMinor = quoteLines.reduce((acc, l) => acc + toMinor(l.lineTotal), 0);

  // 2) Скидка промокода (поверх товаров).
  const discountMinor = promoDiscountMinor(promo, itemsMinor);

  // 3) Доставка (порог сравнивается с суммой после скидки).
  const netItemsMinor = itemsMinor - discountMinor;
  const del = resolveDelivery(delivery, netItemsMinor, promo);

  // 4) Итог.
  const grandMinor = itemsMinor - discountMinor + del.costMinor;
  if (grandMinor < 0) {
    throw new Error('Ошибка расчёта: итог заказа отрицателен.');
  }

  const promoApplied = Boolean(promo) && (discountMinor > 0 || promo?.kind === 'free_delivery');

  return {
    lines: quoteLines,
    itemsTotal: fromMinor(itemsMinor),
    discount: fromMinor(discountMinor),
    deliveryCost: fromMinor(del.costMinor),
    grandTotal: fromMinor(grandMinor),
    promo: {
      applied: promoApplied,
      code: promo && promoApplied ? promo.code : null,
      kind: promo && promoApplied ? promo.kind : null,
      discount: fromMinor(discountMinor),
    },
    delivery: {
      baseCost: fromMinor(toMinor(delivery.cost)),
      cost: fromMinor(del.costMinor),
      free: del.free,
      freeThresholdMet: del.freeThresholdMet,
    },
  };
}
