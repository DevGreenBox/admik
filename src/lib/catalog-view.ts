/**
 * Чистая логика витрины каталога THE CASE: сортировка/деривация над загруженной
 * страницей товаров (StorefrontProduct). Серверный фасетинг (категория/поиск/
 * новинки/распродажа) делает Admik по query-параметрам — здесь только то, что
 * считается client-side над уже полученной выборкой (docs/13 §3.5).
 *
 * Без сети/React — покрыто юнит-тестами (catalog-view.test.ts).
 */

import type { StorefrontProduct, AdmikCategoryDto } from "@/lib/admik";

export type CatalogSort =
  | "default"
  | "price-asc"
  | "price-desc"
  | "new"
  | "bestseller";

/** Диапазон цен по выборке. Пустая выборка → { min: 0, max: 0 }. */
export interface PriceRange {
  min: number;
  max: number;
}

export function priceRange(products: StorefrontProduct[]): PriceRange {
  if (products.length === 0) return { min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const p of products) {
    if (p.price < min) min = p.price;
    if (p.price > max) max = p.price;
  }
  return { min, max };
}

/** Вкладка категории каталога. */
export interface CategoryTab {
  slug: string;
  name: string;
}

/** Вкладки = «Все» + топ-уровень дерева категорий Admik. */
export function categoryTabs(categories: AdmikCategoryDto[]): CategoryTab[] {
  return [
    { slug: "", name: "Все" },
    ...categories.map((c) => ({ slug: c.slug, name: c.name })),
  ];
}

/** Сортировка товаров (не мутирует вход). `bestseller` ещё и фильтрует. */
export function sortProducts(
  products: StorefrontProduct[],
  sort: CatalogSort
): StorefrontProduct[] {
  switch (sort) {
    case "price-asc":
      return [...products].sort((a, b) => a.price - b.price);
    case "price-desc":
      return [...products].sort((a, b) => b.price - a.price);
    case "new":
      return [...products].sort(
        (a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0)
      );
    case "bestseller":
      return products.filter((p) => p.isBestseller);
    default:
      return products;
  }
}

/** Параметры применения вью к выборке страницы. */
export interface CatalogViewParams {
  priceMax: number;
  onlyNew: boolean;
  onlyBestseller: boolean;
  sort: CatalogSort;
}

/**
 * Применяет client-side порог цены + чекбоксы Новинки/Bestsellers + сортировку
 * над уже загруженной (серверно отфильтрованной) выборкой страницы.
 */
export function applyCatalogView(
  products: StorefrontProduct[],
  params: CatalogViewParams
): StorefrontProduct[] {
  let result = products.filter((p) => p.price <= params.priceMax);
  if (params.onlyNew) result = result.filter((p) => p.isNew);
  if (params.onlyBestseller) result = result.filter((p) => p.isBestseller);
  return sortProducts(result, params.sort);
}
