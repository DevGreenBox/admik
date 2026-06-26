/**
 * Авто-навигация витрины из опубликованных CMS-страниц.
 *
 * Принцип: владелец НЕ настраивает меню вручную — любая опубликованная в
 * «Контенте» страница автоматически становится кликабельной ссылкой в шапке
 * («Информация») и футере. Это устраняет «осиротевшие» страницы (есть, но на них
 * нельзя попасть кликом) и делает функционал навигации частью платформы.
 *
 * Чистые функции (без сети/React) — легко тестируются.
 */

export interface SiteNavLink {
  href: string;
  label: string;
}

export interface NavPage {
  slug: string;
  title: string;
}

/**
 * Slug'и, которые НЕ выводим в авто-меню «Информация»: у них уже есть собственная
 * точка входа в навигации (или они являются якорями главной), иначе дублировались бы.
 */
const NAV_HIDE_SLUGS = new Set<string>(['contacts']);

/**
 * Строит ссылки «Информация» из списка опубликованных страниц. Каждая страница →
 * ссылка `/{slug}` с её заголовком. Отбрасывает пустые и служебные slug'и.
 */
export function buildInfoLinks(pages: NavPage[]): SiteNavLink[] {
  return pages
    .filter((p) => p && p.slug.trim().length > 0 && p.title.trim().length > 0)
    .filter((p) => !NAV_HIDE_SLUGS.has(p.slug))
    .map((p) => ({ href: `/${p.slug}`, label: p.title }));
}

// ---------------------------------------------------------------------------
// Навигация шапки и колонки футера (Находки S-nav #18/#30).
// Чистые функции — совмещают кастомное меню владельца (настройки Admik) с
// авто-навигацией платформы, НЕ теряя её. Тестируются без React/сети.
// ---------------------------------------------------------------------------

/** Правые ссылки шапки по умолчанию (Доставка/Контакты). */
export const DEFAULT_NAV_RIGHT: SiteNavLink[] = [
  { href: '/#delivery', label: 'Доставка' },
  { href: '/contacts', label: 'Контакты' },
];

/**
 * Серверные фасеты каталога (F18): ?sale=1 / ?new=1. Свёрнуты в подменю
 * «Коллекция» (см. buildHeaderNav), а НЕ выведены отдельными пунктами верхнего
 * ряда: шесть пунктов в ряд распирали центр-сетку шапки `1fr auto 1fr` — логотип
 * съезжал вправо и наезжал на «Информацию». Внутри выпадашки ссылки остаются
 * достижимы кликом (требование F18 сохранено), а шапка не переполняется.
 */
export const CATALOG_FACETS: SiteNavLink[] = [
  { href: '/catalog?sale=1', label: 'Распродажа' },
  { href: '/catalog?new=1', label: 'Новинки' },
];

/** Пункт навигации шапки; `children` — выпадающее подменю (Коллекция/Информация). */
export interface HeaderNavItem {
  href: string;
  label: string;
  children?: SiteNavLink[];
}

export interface HeaderNav {
  left: HeaderNavItem[];
  right: HeaderNavItem[];
}

/**
 * Навигация шапки. Совмещает кастомное меню владельца (`headerItems` из настроек,
 * G-10) с авто-навигацией платформы, НЕ теряя её:
 *  - кастомное меню (#30): сохраняем выпадающую «Информацию» (опубликованные
 *    CMS-страницы) и правые ссылки «Доставка»/«Контакты» — раньше они обнулялись;
 *  - дефолтное меню (кастома нет): Каталог, Коллекция (+подменю из категорий и
 *    фасетов Распродажа/Новинки, F18), О бренде, Информация. Фасеты свёрнуты в
 *    выпадашку, чтобы не переполнять центр-сетку шапки (логотип по центру).
 * Дубли по href между кастом-меню и правыми ссылками отбрасываются.
 */
export function buildHeaderNav(opts: {
  headerItems?: SiteNavLink[];
  collectionChildren?: SiteNavLink[];
  infoItems?: SiteNavLink[];
}): HeaderNav {
  const headerItems = opts.headerItems ?? [];
  const collectionChildren = opts.collectionChildren ?? [];
  const infoItems = opts.infoItems ?? [];

  // «Информация» — выпадающее меню из опубликованных страниц Контента (авто).
  // Родитель ведёт на первую страницу, дети — все страницы.
  const infoLink: HeaderNavItem | null =
    infoItems.length > 0
      ? { href: infoItems[0].href, label: 'Информация', children: infoItems }
      : null;

  if (headerItems.length > 0) {
    const left: HeaderNavItem[] = [
      ...headerItems.map((i) => ({ href: i.href, label: i.label })),
      ...(infoLink ? [infoLink] : []),
    ];
    // «Доставка»/«Контакты» сохраняем даже при кастомном меню, но без дублей тех
    // href, которые владелец уже добавил в своё меню.
    const customHrefs = new Set(headerItems.map((i) => i.href));
    const right = DEFAULT_NAV_RIGHT.filter((l) => !customHrefs.has(l.href));
    return { left, right };
  }

  // «Коллекция» — всегда выпадашка: категории магазина + фасеты каталога (F18).
  // Даже без категорий внутри есть Распродажа/Новинки, поэтому подменю не пустеет.
  const collectionItems: SiteNavLink[] = [...collectionChildren, ...CATALOG_FACETS];
  const left: HeaderNavItem[] = [
    { href: '/catalog', label: 'Каталог' },
    { href: '/catalog', label: 'Коллекция', children: collectionItems },
    { href: '/#about', label: 'О бренде' },
    ...(infoLink ? [infoLink] : []),
  ];
  return { left, right: [...DEFAULT_NAV_RIGHT] };
}

export interface FooterColumn {
  title: string;
  links: SiteNavLink[];
}

/**
 * Колонки футера. Если владелец задал колонки в настройках (G-11) — берём их,
 * иначе дефолтные колонки витрины. Сверху — авто-колонка «Информация» из
 * опубликованных CMS-страниц, которых ещё нет в выбранных колонках (без дублей),
 * чтобы любая страница оставалась достижимой кликом («осиротевшие» страницы).
 */
export function resolveFooterColumns(opts: {
  settingsColumns?: FooterColumn[];
  defaultColumns: FooterColumn[];
  infoLinks?: SiteNavLink[];
}): FooterColumn[] {
  const base =
    opts.settingsColumns && opts.settingsColumns.length > 0
      ? opts.settingsColumns
      : opts.defaultColumns;
  const baseHrefs = new Set(base.flatMap((c) => c.links.map((l) => l.href)));
  const extraPages = (opts.infoLinks ?? []).filter((l) => !baseHrefs.has(l.href));
  return extraPages.length > 0
    ? [...base, { title: 'Информация', links: extraPages }]
    : base;
}
