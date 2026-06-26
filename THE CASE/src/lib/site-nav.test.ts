import { describe, it, expect } from 'vitest';
import {
  buildInfoLinks,
  buildHeaderNav,
  resolveFooterColumns,
  DEFAULT_NAV_RIGHT,
  CATALOG_FACETS,
} from './site-nav';

describe('buildInfoLinks (авто-навигация из страниц Контента)', () => {
  it('каждая опубликованная страница становится кликабельной ссылкой /{slug}', () => {
    const links = buildInfoLinks([
      { slug: 'about', title: 'О компании' },
      { slug: 'faq', title: 'Вопросы и ответы' },
      { slug: 'delivery', title: 'Доставка и оплата' },
    ]);
    expect(links).toEqual([
      { href: '/about', label: 'О компании' },
      { href: '/faq', label: 'Вопросы и ответы' },
      { href: '/delivery', label: 'Доставка и оплата' },
    ]);
  });

  it('отбрасывает пустые slug/title и служебный slug contacts (есть отдельная ссылка)', () => {
    const links = buildInfoLinks([
      { slug: '', title: 'пусто' },
      { slug: 'x', title: '' },
      { slug: 'contacts', title: 'Контакты' },
      { slug: 'terms', title: 'Соглашение' },
    ]);
    expect(links).toEqual([{ href: '/terms', label: 'Соглашение' }]);
  });

  it('пустой список страниц → пустые ссылки (навигация деградирует на дефолт)', () => {
    expect(buildInfoLinks([])).toEqual([]);
  });
});

describe('buildHeaderNav — дефолтное меню (нет кастома)', () => {
  it('содержит Каталог/Коллекция/О бренде слева и правые Доставка/Контакты (фасеты свёрнуты в «Коллекцию»)', () => {
    const { left, right } = buildHeaderNav({});
    const labels = left.map((l) => l.label);
    // 6 пунктов в ряд распирали центр-сетку шапки → Распродажа/Новинки убраны
    // из верхнего ряда и свёрнуты в подменю «Коллекция» (см. ниже).
    expect(labels).toEqual(['Каталог', 'Коллекция', 'О бренде']);
    expect(right).toEqual(DEFAULT_NAV_RIGHT);
  });

  it('F18: фасеты «Распродажа»/«Новинки» доступны кликом — внутри подменю «Коллекция»', () => {
    const collection = buildHeaderNav({}).left.find((l) => l.label === 'Коллекция');
    expect(collection?.children).toEqual(CATALOG_FACETS);
    expect(collection?.children?.find((c) => c.label === 'Распродажа')?.href).toBe('/catalog?sale=1');
    expect(collection?.children?.find((c) => c.label === 'Новинки')?.href).toBe('/catalog?new=1');
  });

  it('подменю «Коллекция» = категории магазина + фасеты (Распродажа/Новинки в конце)', () => {
    const collectionChildren = [
      { href: '/catalog?category=halaty', label: 'Халаты' },
      { href: '/catalog?category=kostyumy', label: 'Костюмы' },
    ];
    const { left } = buildHeaderNav({ collectionChildren });
    const collection = left.find((l) => l.label === 'Коллекция');
    expect(collection?.children).toEqual([...collectionChildren, ...CATALOG_FACETS]);
  });

  it('без категорий «Коллекция» всё равно выпадашка (только фасеты), href /catalog', () => {
    const collection = buildHeaderNav({}).left.find((l) => l.label === 'Коллекция');
    expect(collection?.children).toEqual(CATALOG_FACETS);
    expect(collection?.href).toBe('/catalog');
  });

  it('добавляет выпадающую «Информацию» из опубликованных страниц', () => {
    const infoItems = [
      { href: '/delivery', label: 'Доставка и оплата' },
      { href: '/faq', label: 'Вопросы' },
    ];
    const info = buildHeaderNav({ infoItems }).left.find((l) => l.label === 'Информация');
    expect(info?.href).toBe('/delivery');
    expect(info?.children).toEqual(infoItems);
  });
});

describe('buildHeaderNav — кастомное меню (G-10) НЕ теряет авто-навигацию (#18/#30)', () => {
  const headerItems = [
    { label: 'Главная', href: '/' },
    { label: 'Каталог', href: '/catalog' },
  ];

  it('левое меню = пункты владельца + сохранённая «Информация»', () => {
    const infoItems = [{ href: '/about', label: 'О компании' }];
    const { left } = buildHeaderNav({ headerItems, infoItems });
    expect(left.map((l) => l.label)).toEqual(['Главная', 'Каталог', 'Информация']);
    expect(left.at(-1)?.children).toEqual(infoItems);
  });

  it('правые ссылки Доставка/Контакты сохраняются даже при кастомном меню (#30)', () => {
    const { right } = buildHeaderNav({ headerItems });
    expect(right.map((l) => l.label)).toEqual(['Доставка', 'Контакты']);
  });

  it('не дублирует правую ссылку, если её href уже есть в кастомном меню', () => {
    const withContacts = [...headerItems, { label: 'Связь', href: '/contacts' }];
    const { right } = buildHeaderNav({ headerItems: withContacts });
    expect(right.map((l) => l.href)).toEqual(['/#delivery']);
  });

  it('без опубликованных страниц «Информация» не добавляется', () => {
    const { left } = buildHeaderNav({ headerItems });
    expect(left.some((l) => l.label === 'Информация')).toBe(false);
  });
});

describe('resolveFooterColumns — колонки футера (#18) с авто-«Информацией»', () => {
  const defaultColumns = [
    { title: 'Service', links: [{ href: '/payment', label: 'Оплата' }] },
    { title: 'Legal', links: [{ href: '/privacy', label: 'Политика' }] },
  ];

  it('нет настроек → дефолтные колонки витрины', () => {
    expect(resolveFooterColumns({ defaultColumns })).toEqual(defaultColumns);
  });

  it('колонки из настроек (G-11) переопределяют дефолтные', () => {
    const settingsColumns = [{ title: 'Магазин', links: [{ href: '/catalog', label: 'Каталог' }] }];
    expect(resolveFooterColumns({ settingsColumns, defaultColumns })).toEqual(settingsColumns);
  });

  it('пустой массив настроек → фолбэк на дефолтные', () => {
    expect(resolveFooterColumns({ settingsColumns: [], defaultColumns })).toEqual(defaultColumns);
  });

  it('добавляет «Информацию» из страниц, которых ещё нет в колонках (без дублей)', () => {
    const infoLinks = [
      { href: '/payment', label: 'Оплата' }, // уже в Service → не дублируем
      { href: '/faq', label: 'Вопросы' }, // новая → попадает в «Информацию»
    ];
    const cols = resolveFooterColumns({ defaultColumns, infoLinks });
    expect(cols).toHaveLength(3);
    expect(cols[2]).toEqual({ title: 'Информация', links: [{ href: '/faq', label: 'Вопросы' }] });
  });

  it('все страницы уже представлены в колонках → колонка «Информация» не добавляется', () => {
    const infoLinks = [{ href: '/payment', label: 'Оплата' }];
    expect(resolveFooterColumns({ defaultColumns, infoLinks })).toEqual(defaultColumns);
  });
});
