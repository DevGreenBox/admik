/**
 * Сборка чека 54-ФЗ Init.Receipt (docs/15 §6). ЧИСТАЯ функция, без сети/БД.
 *
 * Включается только при TBANK_RECEIPT_ENABLED=true (к терминалу подключена
 * онлайн-касса). По умолчанию ВЫКЛЮЧЕНО — buildReceipt вызывается лишь когда
 * receiptEnabled, иначе Receipt в Init не идёт (volna 3, опц.).
 *
 * ИНВАРИАНТ (docs/15 §6, критично): сумма всех Items.Amount ДОЛЖНА равняться
 * Init.Amount (иначе Т-Банк отклонит). Доставка (>0) — отдельной позицией.
 * Суммы — целые КОПЕЙКИ.
 */

import type { Order, OrderItem } from '@/lib/orders/types';
import type { TbankConfig } from './config';
import type { TbankReceipt, TbankReceiptItem } from './types';

/** Рубли-строка NUMERIC(14,2) → целые копейки (округление к ближайшему). */
export function toKopecks(numericRubles: string | number): number {
  const n = typeof numericRubles === 'number' ? numericRubles : Number(numericRubles);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Собирает Receipt из заказа + позиций. Email/Phone — из заказа (одно из двух
 * обязательно). Taxation — из config (TBANK_TAXATION); Tax позиции — defaultTax
 * (TBANK_DEFAULT_TAX). Доставка (deliveryTotal>0) добавляется позицией «Доставка»
 * (PaymentObject:'service'). Возвращает null, если нет ни email, ни телефона
 * (чек невозможен) или taxation не задан.
 */
export function buildReceipt(
  order: Order,
  items: OrderItem[],
  cfg: TbankConfig,
): TbankReceipt | null {
  if (!cfg.taxation) return null;
  const email = order.customerEmail?.trim() || undefined;
  const phone = order.customerPhone?.trim() || undefined;
  if (!email && !phone) return null;

  const receiptItems: TbankReceiptItem[] = items.map((it) => {
    const price = toKopecks(it.unitPrice);
    return {
      Name: it.nameSnapshot.slice(0, 128),
      Quantity: it.quantity,
      Price: price,
      Amount: price * it.quantity,
      Tax: cfg.defaultTax,
      PaymentMethod: 'full_payment',
      PaymentObject: 'commodity',
    };
  });

  const deliveryKop = toKopecks(order.deliveryTotal);
  if (deliveryKop > 0) {
    receiptItems.push({
      Name: 'Доставка',
      Quantity: 1,
      Price: deliveryKop,
      Amount: deliveryKop,
      Tax: cfg.defaultTax,
      PaymentMethod: 'full_payment',
      PaymentObject: 'service',
    });
  }

  return {
    ...(email ? { Email: email } : {}),
    ...(phone ? { Phone: phone } : {}),
    Taxation: cfg.taxation,
    Items: receiptItems,
  };
}

/** Сумма всех Items.Amount чека (для проверки инварианта = Init.Amount). */
export function receiptTotalKop(receipt: TbankReceipt): number {
  return receipt.Items.reduce((acc, it) => acc + it.Amount, 0);
}
