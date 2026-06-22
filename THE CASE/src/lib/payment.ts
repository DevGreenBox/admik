/**
 * Способы оплаты, доступные на витрине. Перекодировка в enum Admik
 * (`cdek-pay`→`cdek_pay`, `card`→`card`, `sbp`→`sbp`) выполняется в `@/lib/checkout`
 * при сборке тела заказа. Сам платёж/эквайринг — на стороне Admik.
 */
export const PAYMENT_METHODS = [
  { id: "cdek-pay", name: "СДЭК PAY", description: "Оплата онлайн или при получении через СДЭК" },
  { id: "card", name: "Банковская карта", description: "Visa, Mastercard, МИР" },
  { id: "sbp", name: "СБП", description: "Система быстрых платежей" },
];
