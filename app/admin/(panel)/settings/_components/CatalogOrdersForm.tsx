'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ActionResult } from '@/lib/server/action';
import type { EffectiveSettings } from '@/lib/config/settings';
import { fromMinor } from '@/lib/orders/money';

import { updateCatalogOrdersAction } from './form-actions';
import { errorMessage, fieldError } from './action-result';

/**
 * Форма каталог/доставка/заказы (docs/11 §5.4.5).
 * freeDeliveryThreshold вводится в РУБЛЯХ; на сервере конвертируется в копейки.
 * Текущее значение приходит в копейках → показываем в рублях через fromMinor.
 */
type Fail = Extract<ActionResult<unknown>, { ok: false }>;

export function CatalogOrdersForm({
  catalog,
  delivery,
  orders,
  checkout,
}: {
  catalog: EffectiveSettings['catalog'];
  delivery: EffectiveSettings['delivery'];
  orders: EffectiveSettings['orders'];
  checkout: EffectiveSettings['checkout'];
}) {
  const router = useRouter();
  const [error, setError] = useState<Fail | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [newProductDays, setNewProductDays] = useState(String(catalog.newProductDays));
  // Копейки → рубли для отображения (0 = выключен).
  const [freeThresholdRub, setFreeThresholdRub] = useState(
    delivery.freeDeliveryThreshold > 0 ? fromMinor(delivery.freeDeliveryThreshold) : '0',
  );
  const [orderPrefix, setOrderPrefix] = useState(orders.orderPrefix);
  // Режим оформления заказа (п.5/п.7).
  const [onlinePaymentEnabled, setOnlinePaymentEnabled] = useState(checkout.onlinePaymentEnabled);
  const [paymentDisabledNotice, setPaymentDisabledNotice] = useState(
    checkout.paymentDisabledNotice ?? '',
  );
  const [giftWrapEnabled, setGiftWrapEnabled] = useState(checkout.giftWrapEnabled);
  const [giftWrapLabel, setGiftWrapLabel] = useState(checkout.giftWrapLabel ?? '');

  async function save() {
    setPending(true);
    setError(null);
    setSuccess(null);
    const result = await updateCatalogOrdersAction({
      catalog: newProductDays.trim() ? { newProductDays: Number(newProductDays) } : undefined,
      delivery: { freeDeliveryThreshold: freeThresholdRub.trim() || '0' },
      orders: { orderPrefix: orderPrefix.trim() },
      // Пустые тексты не шлём: схема схлопнет их в undefined, и витрина возьмёт
      // свои дефолты — так «очистить поле» означает «вернуть стандартный текст».
      checkout: {
        onlinePaymentEnabled,
        paymentDisabledNotice: paymentDisabledNotice.trim() || undefined,
        giftWrapEnabled,
        giftWrapLabel: giftWrapLabel.trim() || undefined,
      },
    });
    setPending(false);
    if (result.ok) {
      setSuccess('Настройки сохранены.');
      router.refresh();
    } else {
      setError(result);
    }
  }

  const fe = (f: string) => fieldError(error, f);

  return (
    <div>
      {error ? (
        <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMessage(error)}
        </div>
      ) : null}
      {success ? (
        <div role="status" className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {success}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <label htmlFor="co-newdays" className="block text-sm font-medium text-gray-700">
            «Новизна» товара (дней)
          </label>
          <input id="co-newdays" type="number" min={0} value={newProductDays}
            onChange={(e) => setNewProductDays(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          {fe('catalog.newProductDays') ? (
            <p className="mt-1 text-xs text-red-600">{fe('catalog.newProductDays')}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor="co-free" className="block text-sm font-medium text-gray-700">
            Порог бесплатной доставки (₽)
          </label>
          <input id="co-free" value={freeThresholdRub} onChange={(e) => setFreeThresholdRub(e.target.value)}
            placeholder="0 = выключено"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          {fe('delivery.freeDeliveryThreshold') ? (
            <p className="mt-1 text-xs text-red-600">{fe('delivery.freeDeliveryThreshold')}</p>
          ) : null}
          <p className="mt-1 text-xs text-gray-500">Сумма заказа, с которой доставка бесплатна. 0 — бесплатной доставки нет.</p>
        </div>
        <div>
          <label htmlFor="co-prefix" className="block text-sm font-medium text-gray-700">
            Префикс номера заказа
          </label>
          <input id="co-prefix" value={orderPrefix} onChange={(e) => setOrderPrefix(e.target.value)}
            placeholder="например GA"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>

      {/* Оформление заказа (правки владельца 2026-07-22, п.5 и п.7). Магазин без
          кассы принимает ЗАЯВКИ: витрина не уводит покупателя на эквайринг, а
          показывает текст-заглушку. Подарочная упаковка — опциональная услуга. */}
      <div className="mt-6 border-t border-gray-200 pt-4">
        <h3 className="text-sm font-semibold text-gray-800">Оформление заказа</h3>
        <div className="mt-3 space-y-4">
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={onlinePaymentEnabled}
              onChange={(e) => setOnlinePaymentEnabled(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Онлайн-оплата на сайте работает
              <span className="mt-0.5 block text-xs text-gray-500">
                Снимите галочку, если касса не подключена: заказ оформится как заявка,
                покупателю покажется текст ниже, на страницу оплаты его не отправят.
              </span>
            </span>
          </label>

          {!onlinePaymentEnabled ? (
            <div>
              <label htmlFor="co-paynotice" className="block text-sm font-medium text-gray-700">
                Текст вместо оплаты
              </label>
              <textarea
                id="co-paynotice"
                rows={2}
                value={paymentDisabledNotice}
                onChange={(e) => setPaymentDisabledNotice(e.target.value)}
                placeholder="Оплата на сайте временно недоступна — свяжемся с вами."
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">Пусто — покажем стандартный текст витрины.</p>
            </div>
          ) : null}

          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={giftWrapEnabled}
              onChange={(e) => setGiftWrapEnabled(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Предлагать подарочную упаковку
              <span className="mt-0.5 block text-xs text-gray-500">
                В корзине появится галочка; отмеченные заказы помечаются в карточке заказа.
              </span>
            </span>
          </label>

          {giftWrapEnabled ? (
            <div>
              <label htmlFor="co-giftlabel" className="block text-sm font-medium text-gray-700">
                Подпись галочки
              </label>
              <input
                id="co-giftlabel"
                value={giftWrapLabel}
                onChange={(e) => setGiftWrapLabel(e.target.value)}
                placeholder="Упаковать в подарочную упаковку"
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3 border-t border-gray-200 pt-4">
        <button type="button" onClick={save} disabled={pending}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {pending ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
