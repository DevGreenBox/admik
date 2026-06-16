/**
 * Типы Storefront API Admik (подмножество, нужное витрине) + витринная вью-модель.
 *
 * Источник правды по DTO бэкенда: `admik/lib/storefront/dto.ts` и `order-dto.ts`.
 * Здесь — только то, что THE CASE реально потребляет. Деньги приходят строками
 * NUMERIC (₽), наличие — булевым `inStock` (точный остаток не раскрывается).
 *
 * См. docs/13-сращивание-the-case.md (§3 контракт данных).
 */

// ---------------------------------------------------------------------------
// DTO бэкенда Admik (как отдаёт /api/storefront/v1).
// ---------------------------------------------------------------------------

export interface AdmikBrandDto {
  slug: string;
  name: string;
  logoUrl: string | null;
}

export interface AdmikMediaDto {
  url: string | null;
  type: string;
  alt: string;
  isPrimary: boolean;
}

export interface AdmikVariantDto {
  id: string;
  sku: string;
  /** Человекочитаемое название варианта (напр. «M» / «Красный / M»); '' если не задано. */
  name: string;
  /** Эффективная цена варианта — строка NUMERIC (₽). */
  price: string;
  compareAtPrice: string | null;
  discountPct: number | null;
  onSale: boolean;
  /** Денормализованные атрибуты варианта (напр. { size: "M" }). */
  attributes: Record<string, unknown>;
  inStock: boolean;
}

export interface AdmikProductListItemDto {
  slug: string;
  name: string;
  price: string;
  compareAtPrice: string | null;
  discountPct: number | null;
  onSale: boolean;
  isNew: boolean;
  isFeatured: boolean;
  brand: AdmikBrandDto | null;
  imageUrl: string | null;
  inStock: boolean;
}

export interface AdmikProductDetailDto {
  slug: string;
  sku: string;
  name: string;
  description: string;
  price: string;
  compareAtPrice: string | null;
  discountPct: number | null;
  onSale: boolean;
  isNew: boolean;
  isFeatured: boolean;
  brand: AdmikBrandDto | null;
  categories: string[];
  attributes: Record<string, unknown>;
  variants: AdmikVariantDto[];
  media: AdmikMediaDto[];
  inStock: boolean;
}

export interface AdmikCategoryDto {
  slug: string;
  name: string;
  description: string;
  children: AdmikCategoryDto[];
}

// ---------------------------------------------------------------------------
// Заказы / расчёт корзины (POST /cart/quote, /orders, GET /orders/:number).
// ---------------------------------------------------------------------------

/** Тип доставки в контракте Admik (orders.delivery_type). */
export type AdmikDeliveryType = 'courier' | 'pvz' | 'pickup';

/** Способ оплаты в контракте Admik (orders.payment_method). */
export type AdmikPaymentMethod =
  | 'unset'
  | 'cod'
  | 'card'
  | 'sbp'
  | 'cdek_pay'
  | 'invoice';

export interface AdmikCartLineInput {
  variantId: string;
  qty: number;
}

export interface AdmikDeliverySelection {
  type: AdmikDeliveryType;
  city?: string;
  address?: string;
  pvzCode?: string;
}

export interface AdmikQuoteInput {
  items: AdmikCartLineInput[];
  promoCode?: string;
  delivery?: AdmikDeliverySelection;
}

export interface AdmikCreateOrderInput {
  items: AdmikCartLineInput[];
  customer: { name: string; email: string; phone: string };
  delivery: AdmikDeliverySelection;
  paymentMethod: AdmikPaymentMethod;
  promoCode?: string;
  comment?: string;
}

export interface AdmikQuoteLineDto {
  name: string;
  sku: string;
  unitPrice: string;
  compareAtPrice: string | null;
  qty: number;
  lineTotal: string;
  isGift: boolean;
}

export interface AdmikQuoteDto {
  itemsTotal: string;
  discountTotal: string;
  deliveryTotal: string;
  grandTotal: string;
  currency: string;
  lines: AdmikQuoteLineDto[];
  promo: { applied: boolean; code: string | null; discount: string; reason: string | null };
  delivery: { free: boolean; freeThresholdMet: boolean; cost: string };
  fulfillable: boolean;
  issues: Array<{ index: number; code: string }>;
}

export interface AdmikOrderCreatedDto {
  number: string;
  status: string;
  paymentStatus: string;
  grandTotal: string;
  currency: string;
  accessToken: string;
}

/** Позиция заказа в публичном виде (снимок; деньги — строки NUMERIC). */
export interface AdmikOrderItemDto {
  name: string;
  sku: string;
  attributes: Record<string, unknown>;
  unitPrice: string;
  compareAtPrice: string | null;
  qty: number;
  lineTotal: string;
  isGift: boolean;
}

/**
 * Публичный заказ для трекинга/ЛК (GET /orders/:number). Зеркало
 * `OrderPublicDto` бэкенда (`admik/lib/storefront/order-dto.ts`): без внутренних
 * id/ip/customerId. Деньги — строки NUMERIC (₽), статусы — строковые литералы.
 */
export interface AdmikOrderPublicDto {
  number: string;
  status: string;
  paymentStatus: string;
  deliveryStatus: string;
  itemsTotal: string;
  discountTotal: string;
  deliveryTotal: string;
  grandTotal: string;
  currency: string;
  promoCode: string | null;
  paymentMethod: string;
  delivery: {
    type: string;
    city: string | null;
    /** Трек-номер СДЭК (если присвоен). */
    track: string | null;
  };
  items: AdmikOrderItemDto[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// СДЭК (delivery/cdek/*).
// ---------------------------------------------------------------------------

export interface AdmikCdekCityDto {
  code: number;
  name: string;
  region: string;
}

export interface AdmikCdekPvzDto {
  code: string;
  name: string;
  address: string;
  type: string;
  location: { latitude: number; longitude: number } | null;
  workTime: string;
}

export interface AdmikCdekCalcDto {
  tariffCode: number;
  cost: number;
  etaDays: number;
  periodMin: number;
  periodMax: number;
}

// ---------------------------------------------------------------------------
// Витринная вью-модель (то, чем оперируют компоненты THE CASE).
// ---------------------------------------------------------------------------

/** Размер товара = вариант каталога. `id` (uuid) уходит в корзину/заказ. */
export interface StorefrontVariant {
  /** uuid варианта — ключ для cart/quote и orders. */
  id: string;
  sku: string;
  /** Метка размера для UI (из attributes.size, иначе sku). */
  size: string;
  price: number;
  inStock: boolean;
}

/** Товар в форме, удобной компонентам витрины (адаптировано из Admik DTO). */
export interface StorefrontProduct {
  slug: string;
  name: string;
  price: number;
  oldPrice?: number;
  discountPct: number | null;
  onSale: boolean;
  isNew: boolean;
  /** «Рекомендуемый» Admik = бестселлер витрины. */
  isBestseller: boolean;
  inStock: boolean;
  imageUrl: string | null;
  images: string[];
  brand: { slug: string; name: string } | null;
  /** Slug-и категорий товара (для связанных/фильтров). */
  categories: string[];
  // --- поля, выводимые из атрибутов (контракт docs/13 §3.2) ---
  gender: 'women' | 'men' | 'unisex';
  color: string;
  composition: string;
  care: string;
  features: string[];
  description: string;
  // --- размеры = варианты ---
  variants: StorefrontVariant[];
  /** Метки размеров (отсортированы), производные от variants. */
  sizes: string[];
}
