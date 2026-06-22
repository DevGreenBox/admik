/**
 * Чистая презентационная логика показа скидки на витрине THE CASE.
 *
 * Источник истины — DTO Admik (compareAtPrice/discountPct/onSale), уже смаппенные
 * адаптером в StorefrontProduct (oldPrice/discountPct/onSale). Здесь — единая точка
 * решения «показывать ли зачёркнутую старую цену + бейдж −N%» для всех мест UI
 * (карточка каталога, QuickView, страница товара), чтобы они не расходились.
 *
 * Без сети/React → покрыто юнит-тестами (pricing.test.ts).
 */

/** Минимум полей товара, нужных для показа скидки (карточка и detail совместимы). */
export interface SalePriceInput {
  price: number;
  oldPrice?: number;
  discountPct: number | null;
  onSale: boolean;
}

/** Готовое представление скидки для UI. */
export interface SaleView {
  /** Показывать ли блок скидки (зачёркнутая цена + бейдж). */
  onSale: boolean;
  /** Старая (зачёркнутая) цена — только когда она валидна и строго больше текущей. */
  oldPrice: number | null;
  /** Процент скидки для бейджа (целое, > 0) или null, если показывать нечего. */
  discountPct: number | null;
  /** Готовая подпись бейджа, напр. «−25%» (null, когда бейдж не показываем). */
  badgeLabel: string | null;
}

const NO_SALE: SaleView = {
  onSale: false,
  oldPrice: null,
  discountPct: null,
  badgeLabel: null,
};

/**
 * Решает, как показать скидку. Скидка показывается только когда товар помечен
 * onSale И есть валидная старая цена строго выше текущей (защита от мусорных
 * данных). Процент берём из discountPct, иначе считаем из (old−price)/old.
 */
export function resolveSaleView(p: SalePriceInput): SaleView {
  if (!p.onSale) return NO_SALE;

  const old = p.oldPrice;
  const hasValidOld =
    typeof old === "number" && Number.isFinite(old) && old > p.price && p.price >= 0;
  if (!hasValidOld) return NO_SALE;

  let pct = p.discountPct;
  if (pct == null || !Number.isFinite(pct) || pct <= 0) {
    pct = Math.round(((old - p.price) / old) * 100);
  } else {
    pct = Math.round(pct);
  }
  if (pct <= 0) return NO_SALE;

  return {
    onSale: true,
    oldPrice: old,
    discountPct: pct,
    badgeLabel: `−${pct}%`,
  };
}
