/**
 * Доменные типы витрины THE CASE.
 *
 * Каталог/категории/товары/варианты приходят из Admik Storefront API и описаны
 * в `@/lib/admik/types` (DTO) и `@/lib/admik/adapter` (модель карточки). Здесь
 * остаётся только UX-состояние, которое витрина хранит сама (zustand): корзина,
 * покупатель, локальные ссылки на заказы для трекинга.
 */

export interface CartItem {
  /**
   * Ключ позиции корзины. Для товара с размерами — uuid варианта; для товара
   * БЕЗ вариантов — uuid товара (productId), чтобы позиция была уникальной.
   */
  variantId: string;
  /**
   * Задан ⇒ товар без вариантов: в Admik (cart/quote/orders) шлём productId,
   * а не variantId. Для товаров с размерами не задаётся.
   */
  productId?: string;
  slug: string;
  name: string;
  size: string;
  price: number;
  imageUrl: string | null;
  quantity: number;
  /**
   * Доступно к заказу (снимок на момент добавления). Ограничивает счётчик
   * количества в корзине, чтобы нельзя было заказать больше остатка. Бэкенд —
   * последняя линия обороны (резерв/quote), но UI не даёт превысить заранее.
   * undefined = лимит неизвестен (старые записи) → не ограничиваем.
   */
  available?: number;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
}

/**
 * Локальная запись о заказе витрины: номер Admik + токен доступа к трекингу
 * (GET /orders/{number}?token=). Источник истины по статусу/суммам — Admik;
 * здесь храним только то, чем заказ находится в ЛК.
 */
export interface Order {
  /** Номер заказа Admik (используется в трекинге/ЛК). */
  number: string;
  /** Токен доступа к заказу (выдан при создании; в БД не хранится). */
  accessToken: string;
  /** Момент сохранения локально (ISO). */
  createdAt: string;
}
