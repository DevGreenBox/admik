import { describe, it, expect } from 'vitest';
import {
  buildInfoLinks,
  buildHeaderNav,
  resolveFooterColumns,
  resolveSocialLinks,
  NAV_DROPDOWN_PANEL_CLASS,
  DEFAULT_NAV_RIGHT,
  CATALOG_FACETS,
} from './site-nav';
import type { ResolvedContacts } from './store-settings';

/** ResolvedContacts с переопределяемыми соцсетями/телеграмом (для resolveSocialLinks). */
function contacts(over: Partial<ResolvedContacts> = {}): ResolvedContacts {
  return {
    phoneDisplay: '+7 (000) 000-00-00',
    phoneTel: '+70000000000',
    email: 'hello@shop.ru',
    telegramHandle: '@shop',
    telegramUrl: 'https://t.me/shop',
    address: null,
    socials: [],
    ...over,
  };
}

describe('buildInfoLinks (авто-навигация из страниц Контента)', () => {
  it('каждая опубликованная страница становится кликабельной ссылкой /{slug}', () => {
    const links = buildInfoLinks([
      { slug: 'about', title: 'О компании' },
      { slug: 'faq', title: 'Вопросы и ответы' },
      { slug: 'returns', title: 'Обмен и возврат' },
    ]);
    expect(links).toEqual([
      { href: '/about', label: 'О компании' },
      { href: '/faq', label: 'Вопросы и ответы' },
      { href: '/returns', label: 'Обмен и возврат' },
    ]);
  });

  it('отбрасывает пустые slug/title и служебные slug contacts/delivery (есть отдельные ссылки)', () => {
    // Правка Ани2 #13: «Доставка и оплата» дублировалась — правый пункт «Доставка»
    // (/#delivery) + авто-ссылка из CMS-страницы /delivery. Прячем slug delivery
    // из «Информации», как и contacts (у обоих есть свой пункт в шапке).
    const links = buildInfoLinks([
      { slug: '', title: 'пусто' },
      { slug: 'x', title: '' },
      { slug: 'contacts', title: 'Контакты' },
      { slug: 'delivery', title: 'Доставка и оплата' },
      { slug: 'terms', title: 'Соглашение' },
    ]);
    expect(links).toEqual([{ href: '/terms', label: 'Соглашение' }]);
  });

  it('пустой список страниц → пустые ссылки (навигация деградирует на дефолт)', () => {
    expect(buildInfoLinks([])).toEqual([]);
  });
});

describe('buildHeaderNav — дефолтное меню (нет кастома)', () => {
  it('содержит Каталог/О бренде слева и правые Доставка/Контакты (Каталог = выпадашка, без дубля «Коллекция»)', () => {
    const { left, right } = buildHeaderNav({});
    const labels = left.map((l) => l.label);
    // Правка Ани2 #3: «Каталог» и «Коллекция» дублировали друг друга (оба /catalog).
    // Оставлен ОДИН пункт «Каталог» с выпадающим подменю (категории + фасеты);
    // отдельная «Коллекция» убрана.
    expect(labels).toEqual(['Каталог', 'О бренде']);
    expect(right).toEqual(DEFAULT_NAV_RIGHT);
  });

  it('F18: фасеты «Распродажа»/«Новинки» доступны кликом — внутри подменю «Каталог»', () => {
    const catalog = buildHeaderNav({}).left.find((l) => l.label === 'Каталог');
    expect(catalog?.children).toEqual(CATALOG_FACETS);
    expect(catalog?.children?.find((c) => c.label === 'Распродажа')?.href).toBe('/catalog?sale=1');
    expect(catalog?.children?.find((c) => c.label === 'Новинки')?.href).toBe('/catalog?new=1');
  });

  it('подменю «Каталог» = категории магазина + фасеты (Распродажа/Новинки в конце)', () => {
    const collectionChildren = [
      { href: '/catalog?category=halaty', label: 'Халаты' },
      { href: '/catalog?category=kostyumy', label: 'Костюмы' },
    ];
    const { left } = buildHeaderNav({ collectionChildren });
    const catalog = left.find((l) => l.label === 'Каталог');
    expect(catalog?.children).toEqual([...collectionChildren, ...CATALOG_FACETS]);
  });

  it('без категорий «Каталог» всё равно выпадашка (только фасеты), href /catalog', () => {
    const catalog = buildHeaderNav({}).left.find((l) => l.label === 'Каталог');
    expect(catalog?.children).toEqual(CATALOG_FACETS);
    expect(catalog?.href).toBe('/catalog');
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

describe('NAV_DROPDOWN_PANEL_CLASS — выпадашка шапки открывается с клавиатуры (C9)', () => {
  it('добавляет focus-within варианты (доступность с Tab), сохраняя hover', () => {
    // Клавиатурная навигация: фокус на триггере внутри group/nav должен делать
    // панель видимой (group-focus-within), иначе дети выпадают из tab-order.
    expect(NAV_DROPDOWN_PANEL_CLASS).toContain('group-focus-within/nav:visible');
    expect(NAV_DROPDOWN_PANEL_CLASS).toContain('group-focus-within/nav:opacity-100');
    // Hover-поведение не теряем.
    expect(NAV_DROPDOWN_PANEL_CLASS).toContain('group-hover/nav:visible');
    expect(NAV_DROPDOWN_PANEL_CLASS).toContain('group-hover/nav:opacity-100');
  });
});

describe('resolveSocialLinks — соцссылки футера без битых якорей (C10/C21)', () => {
  it('пустые socials + telegram → один рабочий Telegram, без "#"/Instagram', () => {
    const links = resolveSocialLinks(contacts({ socials: [], telegramUrl: 'https://t.me/acme' }));
    expect(links).toEqual([{ label: 'Telegram', href: 'https://t.me/acme' }]);
    expect(links.every((l) => l.href !== '#')).toBe(true);
    expect(links.some((l) => l.label === 'Instagram')).toBe(false);
  });

  it('пустые socials без telegram → [] (никаких мёртвых ссылок)', () => {
    expect(resolveSocialLinks(contacts({ socials: [], telegramUrl: null }))).toEqual([]);
  });

  it('заданные socials маппятся в {label,href} с сохранением порядка', () => {
    const links = resolveSocialLinks(
      contacts({
        socials: [
          { type: 'Instagram', url: 'https://instagram.com/acme' },
          { type: 'Telegram', url: 'https://t.me/acme' },
        ],
      }),
    );
    expect(links).toEqual([
      { label: 'Instagram', href: 'https://instagram.com/acme' },
      { label: 'Telegram', href: 'https://t.me/acme' },
    ]);
  });

  it('отбрасывает записи с пустым url и с "#"', () => {
    const links = resolveSocialLinks(
      contacts({
        socials: [
          { type: 'Instagram', url: 'https://instagram.com/acme' },
          { type: 'X', url: '' },
          { type: 'VK', url: '#' },
        ],
      }),
    );
    expect(links).toEqual([{ label: 'Instagram', href: 'https://instagram.com/acme' }]);
  });
});

/**
 * SECURITY (аудит 2026-07-18, находка #11). Ссылки меню/футера приходят из настроек
 * Admik (navigation.header / navigation.footer) и из CMS-страниц. Admik валидирует
 * их на записи, но в БД могут лежать значения, записанные до появления валидации
 * или напрямую SQL. Навигация обязана выбрасывать такие ссылки, а не рендерить.
 */
describe('навигация отбрасывает небезопасные href (находка #11)', () => {
  const UNSAFE = [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example',
    '/\\evil.com',
    'catalog',
  ];

  it.each(UNSAFE)('buildHeaderNav выкидывает пункт меню с href %j', (href) => {
    const nav = buildHeaderNav({
      headerItems: [
        { href: '/catalog', label: 'Каталог' },
        { href, label: 'Зло' },
      ],
    });
    const hrefs = nav.left.map((i) => i.href);
    expect(hrefs).toContain('/catalog');
    expect(hrefs).not.toContain(href);
  });

  it('buildHeaderNav чистит и вложенные пункты подменю', () => {
    const nav = buildHeaderNav({
      collectionChildren: [
        { href: '/catalog/tops', label: 'Топы' },
        { href: '/\\evil.com', label: 'Зло' },
      ],
      infoItems: [
        { href: 'javascript:alert(1)', label: 'Зло' },
        { href: '/about', label: 'О нас' },
      ],
    });
    const children = nav.left.flatMap((i) => i.children ?? []).map((c) => c.href);
    expect(children).toContain('/catalog/tops');
    expect(children).not.toContain('/\\evil.com');
    expect(children).not.toContain('javascript:alert(1)');
    // «Информация» строится только из уцелевших ссылок и ведёт на первую из них.
    const info = nav.left.find((i) => i.label === 'Информация');
    expect(info?.href).toBe('/about');
  });

  it('buildHeaderNav не создаёт «Информацию», если все её ссылки небезопасны', () => {
    const nav = buildHeaderNav({
      infoItems: [{ href: '//evil.example', label: 'Зло' }],
    });
    expect(nav.left.some((i) => i.label === 'Информация')).toBe(false);
  });

  it.each(UNSAFE)('resolveFooterColumns выкидывает ссылку %j', (href) => {
    const cols = resolveFooterColumns({
      settingsColumns: [
        {
          title: 'Магазин',
          links: [
            { href: '/catalog', label: 'Каталог' },
            { href, label: 'Зло' },
          ],
        },
      ],
      defaultColumns: [],
    });
    const hrefs = cols.flatMap((c) => c.links.map((l) => l.href));
    expect(hrefs).toContain('/catalog');
    expect(hrefs).not.toContain(href);
  });

  it('resolveFooterColumns убирает колонку, в которой не осталось ссылок', () => {
    const cols = resolveFooterColumns({
      settingsColumns: [
        { title: 'Зло', links: [{ href: 'javascript:alert(1)', label: 'Зло' }] },
        { title: 'Магазин', links: [{ href: '/catalog', label: 'Каталог' }] },
      ],
      defaultColumns: [],
    });
    expect(cols.map((c) => c.title)).toEqual(['Магазин']);
  });

  it.each(UNSAFE)('resolveSocialLinks выкидывает соцссылку %j', (url) => {
    const links = resolveSocialLinks(
      contacts({
        socials: [
          { type: 'Telegram', url: 'https://t.me/acme' },
          { type: 'Зло', url },
        ],
      }),
    );
    expect(links).toEqual([{ label: 'Telegram', href: 'https://t.me/acme' }]);
  });

  it('buildInfoLinks не может породить небезопасный href (slug экранируется в путь)', () => {
    // Ссылка собирается как `/${slug}` — но slug вида '\evil.com' дал бы '/\evil.com'.
    const links = buildInfoLinks([
      { slug: 'about', title: 'О нас' },
      { slug: '\\evil.com', title: 'Зло' },
    ]);
    expect(links.map((l) => l.href)).toEqual(['/about']);
  });
});
