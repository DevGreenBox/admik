"use client";

import { usePriceFormatter } from "@/components/CurrencyProvider";
import { resolveSaleView, type SalePriceInput } from "@/lib/pricing";

/**
 * Единый показ цены с учётом скидки: текущая цена + (при наличии скидки)
 * зачёркнутая старая цена и бейдж «−N%». Решение о показе — в чистом
 * resolveSaleView (pricing.ts), здесь только разметка. Переиспользуется
 * карточкой каталога, QuickView и страницей товара, чтобы они не расходились.
 */
interface PriceDisplayProps {
  product: SalePriceInput;
  /** Класс размера/трекинга текущей цены — задаёт контекст (карточка/модал/деталь). */
  className?: string;
  /** Бейдж «−N%» (на странице товара он избыточен рядом со старой ценой). */
  showBadge?: boolean;
}

export function PriceDisplay({ product, className = "", showBadge = true }: PriceDisplayProps) {
  const formatPrice = usePriceFormatter();
  const sale = resolveSaleView(product);

  if (!sale.onSale || sale.oldPrice == null) {
    return <span className={`tabular-nums ${className}`}>{formatPrice(product.price)}</span>;
  }

  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={`text-accent tabular-nums ${className}`}>{formatPrice(product.price)}</span>
      <span className="text-[11px] tracking-[0.06em] text-muted line-through tabular-nums">
        {formatPrice(sale.oldPrice)}
      </span>
      {showBadge && sale.badgeLabel && (
        <span className="text-[9px] uppercase tracking-[0.12em] text-accent border border-accent/40 px-1.5 py-0.5">
          {sale.badgeLabel}
        </span>
      )}
    </span>
  );
}
