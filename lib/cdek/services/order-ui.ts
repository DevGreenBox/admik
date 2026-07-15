/**
 * Чистые (без сети/БД) UI-хелперы блока «Создать отправление» карточки заказа.
 *
 * Выделено из order.ts, чтобы клиентский компонент CdekBlock.tsx мог их
 * импортировать НЕ затягивая серверный граф order.ts (postgres.js → dns/net/tls/
 * fs), который иначе валит клиентский бандл Turbopack (`next build`). order.ts
 * реэкспортит эти же символы для серверных потребителей и тестов.
 */

/** UI-состояние блока «Создать отправление» в карточке заказа. */
export interface ShipmentCreateUiState {
  /** Показывать кнопку ручного создания отправления. */
  showCreateButton: boolean;
  /** Показывать пояснение «накладная — после оплаты» (штатный режим с кассой). */
  showAwaitPaymentNotice: boolean;
  /** Показывать подсказку «магазин без кассы — накладная без ожидания оплаты». */
  showCreateWithoutPaymentHint: boolean;
}

/**
 * Чистое решение, что рисовать в блоке создания отправления (карточка заказа) —
 * зеркало серверного canCreateShipment для UI. Ключевое (демо «без оплаты»):
 * при createOnOrder (магазин без онлайн-кассы) кнопка доступна и для
 * НЕОПЛАЧЕННОГО заказа — иначе UI прятал бы её в обход разрешающего сервера
 * (paymentReady раньше не учитывал createOnOrder). Самовывоз и уже созданное
 * отправление — ни кнопки, ни уведомлений.
 */
export function shipmentCreateUiState(args: {
  hasShipment: boolean;
  isPickup: boolean;
  paymentReady: boolean;
  createOnOrder: boolean;
}): ShipmentCreateUiState {
  const { hasShipment, isPickup, paymentReady, createOnOrder } = args;
  if (hasShipment || isPickup) {
    return {
      showCreateButton: false,
      showAwaitPaymentNotice: false,
      showCreateWithoutPaymentHint: false,
    };
  }
  const canCreateNow = paymentReady || createOnOrder;
  return {
    showCreateButton: canCreateNow,
    // «Ждём оплату» — только в штатном режиме с кассой (без createOnOrder).
    showAwaitPaymentNotice: !canCreateNow,
    // Подсказка про режим без кассы — когда флаг включён, а оплаты ещё нет.
    showCreateWithoutPaymentHint: createOnOrder && !paymentReady,
  };
}
