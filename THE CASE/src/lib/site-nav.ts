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

import type { ResolvedContacts } from '@/lib/store-settings';
import { isSafeHref } from '@/lib/safe-href';

export interface SiteNavLink {
  href: string;
  label: string;
}

/**
 * SECURITY (аудит 2026-07-18, находка #11). Ссылки навигации приходят из настроек
 * Admik (navigation.header/footer, contacts.socials) и из slug'ов CMS-страниц.
 * Admik валидирует их на записи, но в БД могут лежать значения, записанные ДО
 * появления валидации или напрямую через SQL. Здесь — второй рубеж: небезопасная
 * ссылка не «чинится» фолбэком, а ВЫБРАСЫВАЕТСЯ из меню (мёртвый пункт лучше, чем
 * пункт, уводящий на чужой домен или исполняющий javascript:).
 */
function keepSafe(links: SiteNavLink[]): SiteNavLink[] {
  return links.filter((l) => isSafeHref(l.href));
}

export interface NavPage {
  slug: string;
  title: string;
}

/**
 * Slug'и, которые НЕ выводим в авто-меню «Информация»: у них уже есть собственная
 * точка входа в навигации (или они являются якорями главной), иначе дублировались бы.
 */
const NAV_HIDE_SLUGS = new Set<string>(['contacts', 'delivery']);

/**
 * Строит ссылки «Информация» из списка опубликованных страниц. Каждая страница →
 * ссылка `/{slug}` с её заголовком. Отбрасывает пустые и служебные slug'и.
 */
export function buildInfoLinks(pages: NavPage[]): SiteNavLink[] {
  return keepSafe(
    pages
      .filter((p) => p && p.slug.trim().length > 0 && p.title.trim().length > 0)
      .filter((p) => !NAV_HIDE_SLUGS.has(p.slug))
      .map((p) => ({ href: `/${p.slug}`, label: p.title })),
  );
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
  // Небезопасные href отсекаются НА ВХОДЕ (находка #11): дальше по функции они
  // попали бы и в верхний ряд, и в подменю, и в родителя «Информации».
  const headerItems = keepSafe(opts.headerItems ?? []);
  const collectionChildren = keepSafe(opts.collectionChildren ?? []);
  const infoItems = keepSafe(opts.infoItems ?? []);

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
  // Правка Ани2 #3: «Каталог» и «Коллекция» дублировали друг друга (оба ведут на
  // /catalog). Оставлен ОДИН пункт «Каталог» с выпадающим подменю (категории +
  // фасеты Распродажа/Новинки) — отдельная «Коллекция» убрана.
  const left: HeaderNavItem[] = [
    { href: '/catalog', label: 'Каталог', children: collectionItems },
    { href: '/#about', label: 'О бренде' },
    ...(infoLink ? [infoLink] : []),
  ];
  return { left, right: [...DEFAULT_NAV_RIGHT] };
}

/**
 * Классы панели выпадающего подменю шапки (C9). Вынесены из inline-строки
 * Header.tsx, чтобы покрыть юнит-тестом доступность с клавиатуры: помимо hover
 * добавлены `group-focus-within/nav` варианты — при фокусе на триггере внутри
 * `group/nav` панель становится видимой, и её дочерние ссылки попадают в tab-order
 * (иначе `invisible` выкидывает их из навигации клавиатурой, нарушая WCAG 2.1.1).
 */
export const NAV_DROPDOWN_PANEL_CLASS =
  'invisible absolute left-0 top-full pt-4 opacity-0 transition-opacity duration-300 ' +
  'group-hover/nav:visible group-hover/nav:opacity-100 ' +
  'group-focus-within/nav:visible group-focus-within/nav:opacity-100';

/**
 * Соцссылки футера (C10/C21). Чистая, мультитенантная — без хардкода под магазин.
 *  - заданы соцсети владельца → маппим `{type,url}` в `{label,href}` (порядок сохр.);
 *  - иначе показываем ТОЛЬКО Telegram и лишь при валидном `telegramUrl` (никакого
 *    Instagram-якоря "#": реального дефолтного URL для него нет);
 *  - финальный фильтр отбрасывает любые пустые/`"#"` ссылки — на витрине никогда не
 *    появляется мёртвый якорь, даже если соцсеть настроена с пустым URL.
 */
export function resolveSocialLinks(c: ResolvedContacts): SiteNavLink[] {
  const links: SiteNavLink[] =
    c.socials.length > 0
      ? c.socials.map((s) => ({ label: s.type, href: s.url }))
      : c.telegramUrl
        ? [{ label: 'Telegram', href: c.telegramUrl }]
        : [];
  // isSafeHref уже отсекает пустое; '#' отдельно — мёртвый якорь в футере не нужен.
  return keepSafe(links).filter((l) => l.href.trim() !== '#');
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
  const raw =
    opts.settingsColumns && opts.settingsColumns.length > 0
      ? opts.settingsColumns
      : opts.defaultColumns;
  // Находка #11: чистим ссылки колонок и убираем колонку, которая после чистки
  // осталась пустой (заголовок без единой ссылки — визуальный мусор).
  const base = raw
    .map((c) => ({ ...c, links: keepSafe(c.links) }))
    .filter((c) => c.links.length > 0);
  const baseHrefs = new Set(base.flatMap((c) => c.links.map((l) => l.href)));
  const extraPages = keepSafe(opts.infoLinks ?? []).filter((l) => !baseHrefs.has(l.href));
  return extraPages.length > 0
    ? [...base, { title: 'Информация', links: extraPages }]
    : base;
}
