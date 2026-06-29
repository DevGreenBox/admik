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

/**
 * Подкатегории активного таба верхнего уровня (B8) — второй ряд фильтров каталога.
 *
 * Когда активна категория верхнего уровня `activeTabSlug`, возвращает её ПРЯМЫХ
 * детей как вкладки; если детей нет / активен «Все» / slug неизвестен — пустой
 * массив (второй ряд не рендерится). Зачем: вкладки первого уровня (categoryTabs)
 * строятся только из топ-уровня, поэтому у подкатегорий, которые владелец создаёт
 * в админке («Внутри категории»), не было своих кнопок-фильтров на витрине —
 * попасть в них можно было лишь из дропдауна шапки. Этот ряд делает подкатегории
 * видимым фильтром каталога. Мультитенантно: работает на дереве любого магазина.
 */
export function subcategoryTabs(
  categories: AdmikCategoryDto[],
  activeTabSlug: string,
): CategoryTab[] {
  if (!activeTabSlug) return [];
  const top = categories.find((c) => c.slug === activeTabSlug);
  if (!top?.children?.length) return [];
  return top.children.map((c) => ({ slug: c.slug, name: c.name }));
}

/**
 * По slug активной категории возвращает slug её ТОП-УРОВНЕВОГО предка в дереве.
 *
 * Зачем: вкладки каталога (`categoryTabs`) строятся только из верхнего уровня
 * дерева. Когда пользователь заходит в подкатегорию, её slug не совпадает ни с
 * одним табом → ни один таб не подсвечивается и пользователь «теряется». Эта
 * функция резолвит ближайший родительский таб верхнего уровня, чтобы подсветка
 * сохранялась на всю ветку.
 *
 * Возвращает:
 *  - "" (нет активного предка) если activeSlug пустой («Все») или не найден;
 *  - сам activeSlug, если он уже категория верхнего уровня;
 *  - slug top-level предка, если activeSlug — подкатегория любой глубины.
 */
export function topLevelAncestorSlug(
  categories: AdmikCategoryDto[],
  activeSlug: string,
): string {
  if (!activeSlug) return "";

  // Глубинный поиск: содержит ли поддерево узел с искомым slug.
  const subtreeHasSlug = (node: AdmikCategoryDto): boolean => {
    if (node.slug === activeSlug) return true;
    return node.children?.some(subtreeHasSlug) ?? false;
  };

  for (const top of categories) {
    if (subtreeHasSlug(top)) return top.slug;
  }
  return "";
}

/** Ссылка подменю навигации (одна категория любого уровня). */
export interface CategoryNavItem {
  href: string;
  label: string;
}

/**
 * Плоский список ссылок для подменю «Коллекция»: дерево категорий Admik
 * (родители + ВЛОЖЕННЫЕ children) обходом в глубину. Дети визуально сдвинуты
 * префиксом «— » по глубине — чтобы в одноуровневом дропдауне читалась иерархия
 * (та же конвенция, что в админском дереве категорий, CategoryManager).
 *
 * Раньше Header брал только верхний уровень (`categories.map`) → подкатегории,
 * которые владелец создаёт в админке («Внутри категории»), НЕ показывались в
 * навигации витрины. href ведёт на каталог, отфильтрованный по slug категории.
 */
export function flattenCategoryNav(
  categories: AdmikCategoryDto[],
  depth = 0,
): CategoryNavItem[] {
  const out: CategoryNavItem[] = [];
  for (const c of categories) {
    out.push({
      href: `/catalog?category=${encodeURIComponent(c.slug)}`,
      label: depth > 0 ? `${"— ".repeat(depth)}${c.name}` : c.name,
    });
    if (c.children?.length) {
      out.push(...flattenCategoryNav(c.children, depth + 1));
    }
  }
  return out;
}

/**
 * Эвристики «тематическая ссылка главной → РЕАЛЬНАЯ категория».
 *
 * Главная THE CASE содержит редизайн-блоки (Women/Men, Костюмы/Халаты/Аксессуары),
 * чьи ссылки РАНЬШЕ вели на ЖЁСТКО ЗАШИТЫЕ slug (women/men/suits/coats/accessories).
 * В каталоге магазина таких slug нет → каждая ссылка открывала ПУСТОЙ каталог
 * (битая клиентская навигация, жалоба владельца). Теперь тема резолвится в slug
 * реальной категории магазина по паттерну (slug ИЛИ имя), иначе деградирует к
 * /catalog — полный каталог, ссылка НИКОГДА не ведёт «в пустоту». Универсально:
 * совпадения ищутся в реальном дереве категорий Admik (любой ИМ, не только THE CASE).
 */
const CATEGORY_HINT_PATTERNS: Record<string, RegExp> = {
  women: /(women|female|zhensk|zhen|жен)/i,
  men: /(\bmen\b|male|muzhsk|muzh|муж)/i,
  suits: /(suit|kostyum|костюм)/i,
  coats: /(coat|gown|halat|халат)/i,
  accessories: /(accessor|aksessuar|аксессуар)/i,
};

/** Плоский обход дерева категорий (родители + дети любой глубины, DFS). */
function flattenCategories(categories: AdmikCategoryDto[]): AdmikCategoryDto[] {
  const out: AdmikCategoryDto[] = [];
  const walk = (nodes: AdmikCategoryDto[]) => {
    for (const c of nodes) {
      out.push(c);
      if (c.children?.length) walk(c.children);
    }
  };
  walk(categories);
  return out;
}

function catHref(slug: string): string {
  return `/catalog?category=${encodeURIComponent(slug)}`;
}

/**
 * Резолвит тематическую ссылку главной в href РЕАЛЬНОЙ категории:
 *   1) точное совпадение slug === hint (если тема уже = реальному slug);
 *   2) паттерн темы (women/men/suits/coats/accessories) по slug ИЛИ имени;
 *   3) фолбэк /catalog (полный каталог — ссылка не ведёт в пустоту).
 */
export function resolveCategoryHref(
  categories: AdmikCategoryDto[],
  hint: string,
): string {
  const all = flattenCategories(categories);
  const exact = all.find((c) => c.slug === hint);
  if (exact) return catHref(exact.slug);
  const pattern = CATEGORY_HINT_PATTERNS[hint.toLowerCase()];
  if (pattern) {
    const m = all.find((c) => pattern.test(c.slug) || pattern.test(c.name));
    if (m) return catHref(m.slug);
  }
  return "/catalog";
}

/** Ссылка на реальную категорию (для плиток главной/футера). */
export interface CategoryLink {
  slug: string;
  name: string;
  href: string;
}

/**
 * Реальные категории (топ + дети, DFS) ссылками для главной/футера: до `max`.
 * Пустой вход → пустой массив (вызывающий деградирует к статичным ссылкам).
 */
export function categoryLinks(
  categories: AdmikCategoryDto[],
  max = 6,
): CategoryLink[] {
  return flattenCategories(categories)
    .slice(0, Math.max(0, max))
    .map((c) => ({ slug: c.slug, name: c.name, href: catHref(c.slug) }));
}

/**
 * Серверные фасеты каталога (C22). Чистая сборка URL `/catalog?...` с сохранением
 * категории/поиска и флагов `sale`/`new`. Используется для removable-чипов активных
 * фасетов на витрине каталога: даёт И индикацию активного фасета, И снятие в один
 * клик. Мультитенантно — никакой привязки к конкретному магазину.
 */
export interface CatalogFacetParams {
  category?: string;
  q?: string;
  sale?: boolean;
  isNew?: boolean;
}

export function buildCatalogHref(params: CatalogFacetParams): string {
  const parts: string[] = [];
  if (params.category) parts.push(`category=${encodeURIComponent(params.category)}`);
  if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
  if (params.sale) parts.push('sale=1');
  if (params.isNew) parts.push('new=1');
  return parts.length > 0 ? `/catalog?${parts.join('&')}` : '/catalog';
}

/** Снимает один фасет (`sale`/`isNew`), сохраняя остальные параметры. */
export function removeFacet(
  params: CatalogFacetParams,
  facet: 'sale' | 'isNew',
): string {
  return buildCatalogHref({ ...params, [facet]: false });
}

/** Сортировка товаров (не мутирует вход). */
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
      // Сортировка, а НЕ фильтр: бестселлеры поднимаются наверх, остальные товары
      // остаются в выдаче (стабильная сортировка сохраняет исходный порядок внутри
      // групп). Раньше здесь был filter — он молча вырезал не-бестселлеры, и каталог
      // внезапно «пустел» при выборе пункта «Bestsellers» в дропдауне сортировки.
      return [...products].sort(
        (a, b) => (b.isBestseller ? 1 : 0) - (a.isBestseller ? 1 : 0)
      );
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
