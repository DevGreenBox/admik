import { describe, it, expect } from "vitest";
import {
  priceRange,
  categoryTabs,
  subcategoryTabs,
  splitByGender,
  sortProducts,
  applyCatalogView,
  flattenCategoryNav,
  topLevelAncestorSlug,
  resolveCategoryHref,
  categoryLinks,
  topCategoryLinks,
  buildCatalogHref,
  removeFacet,
} from "@/lib/catalog-view";
import type { StorefrontProduct, AdmikCategoryDto } from "@/lib/admik";

/** Реальное дерево категорий стенда THE CASE (для эвристик главной). */
const REAL_CATS: AdmikCategoryDto[] = [
  { slug: "meditsinskie-kostyumy", name: "Медицинские костюмы", description: "", children: [] },
  {
    slug: "hirurgicheskie-operatsionnye",
    name: "Хирургические (операционные)",
    description: "",
    children: [
      { slug: "hirurgicheskie-zhen", name: "Хирургические (жен)", description: "", children: [] },
      { slug: "hirurgicheskie-muzh", name: "Хирургические (муж)", description: "", children: [] },
    ],
  },
];

function mk(over: Partial<StorefrontProduct>): StorefrontProduct {
  return {
    slug: over.slug ?? "p",
    name: over.name ?? "Product",
    price: over.price ?? 1000,
    oldPrice: over.oldPrice,
    discountPct: over.discountPct ?? null,
    onSale: over.onSale ?? false,
    isNew: over.isNew ?? false,
    isBestseller: over.isBestseller ?? false,
    inStock: over.inStock ?? true,
    availableQty: over.availableQty ?? 10,
    imageUrl: over.imageUrl ?? null,
    images: over.images ?? [],
    brand: over.brand ?? null,
    categories: over.categories ?? [],
    gender: over.gender ?? "unisex",
    color: over.color ?? "",
    composition: over.composition ?? "",
    care: over.care ?? "",
    features: over.features ?? [],
    description: over.description ?? "",
    variants: over.variants ?? [],
    sizes: over.sizes ?? [],
  };
}

describe("priceRange", () => {
  it("пустая выборка → {0,0}", () => {
    expect(priceRange([])).toEqual({ min: 0, max: 0 });
  });

  it("вычисляет min/max по выборке", () => {
    const products = [mk({ price: 5000 }), mk({ price: 1200 }), mk({ price: 9900 })];
    expect(priceRange(products)).toEqual({ min: 1200, max: 9900 });
  });

  it("единственный товар → min === max", () => {
    expect(priceRange([mk({ price: 4900 })])).toEqual({ min: 4900, max: 4900 });
  });
});

describe("categoryTabs", () => {
  it("первая вкладка — «Все» с пустым slug, далее топ-уровень", () => {
    const cats: AdmikCategoryDto[] = [
      { slug: "women", name: "Женское", description: "", children: [] },
      { slug: "men", name: "Мужское", description: "", children: [] },
    ];
    expect(categoryTabs(cats)).toEqual([
      { slug: "", name: "Все" },
      { slug: "women", name: "Женское" },
      { slug: "men", name: "Мужское" },
    ]);
  });

  it("пустое дерево → только «Все»", () => {
    expect(categoryTabs([])).toEqual([{ slug: "", name: "Все" }]);
  });
});

describe("subcategoryTabs — второй ряд: подкатегории активного таба (B8)", () => {
  it("активен таб БЕЗ детей → пустой массив (второй ряд скрыт)", () => {
    expect(subcategoryTabs(REAL_CATS, "meditsinskie-kostyumy")).toEqual([]);
  });

  it("активен таб С детьми → его прямые дети вкладками (slug+имя)", () => {
    expect(subcategoryTabs(REAL_CATS, "hirurgicheskie-operatsionnye")).toEqual([
      { slug: "hirurgicheskie-zhen", name: "Хирургические (жен)" },
      { slug: "hirurgicheskie-muzh", name: "Хирургические (муж)" },
    ]);
  });

  it("«Все» (пустой slug) → пустой массив", () => {
    expect(subcategoryTabs(REAL_CATS, "")).toEqual([]);
  });

  it("неизвестный slug → пустой массив", () => {
    expect(subcategoryTabs(REAL_CATS, "nope")).toEqual([]);
  });
});

describe("splitByGender — деление featured-товаров на жен/муж для главной (B5)", () => {
  const w = mk({ slug: "w", gender: "women" });
  const m = mk({ slug: "m", gender: "men" });
  const u = mk({ slug: "u", gender: "unisex" });

  it("женские → women, мужские → men", () => {
    const r = splitByGender([w, m]);
    expect(r.women.map((p) => p.slug)).toEqual(["w"]);
    expect(r.men.map((p) => p.slug)).toEqual(["m"]);
  });

  it("унисекс попадает в ОБЕ вкладки (ни одна не пустует из-за пола)", () => {
    const r = splitByGender([u]);
    expect(r.women.map((p) => p.slug)).toEqual(["u"]);
    expect(r.men.map((p) => p.slug)).toEqual(["u"]);
  });

  it("сохраняет исходный порядок внутри корзины", () => {
    const w2 = mk({ slug: "w2", gender: "women" });
    expect(splitByGender([w, w2]).women.map((p) => p.slug)).toEqual(["w", "w2"]);
  });

  it("пустой вход → пустые корзины", () => {
    expect(splitByGender([])).toEqual({ women: [], men: [] });
  });
});

describe("resolveCategoryHref — тематическая ссылка главной → реальная категория", () => {
  it("women → реальная женская подкатегория (по 'zhen')", () => {
    expect(resolveCategoryHref(REAL_CATS, "women")).toBe(
      "/catalog?category=hirurgicheskie-zhen",
    );
  });

  it("men → реальная мужская подкатегория ('muzh'), НЕ путается с women", () => {
    expect(resolveCategoryHref(REAL_CATS, "men")).toBe(
      "/catalog?category=hirurgicheskie-muzh",
    );
  });

  it("suits → реальные «Медицинские костюмы» (по 'kostyum')", () => {
    expect(resolveCategoryHref(REAL_CATS, "suits")).toBe(
      "/catalog?category=meditsinskie-kostyumy",
    );
  });

  it("coats/accessories без совпадения → фолбэк /catalog (НЕ пустой каталог)", () => {
    expect(resolveCategoryHref(REAL_CATS, "coats")).toBe("/catalog");
    expect(resolveCategoryHref(REAL_CATS, "accessories")).toBe("/catalog");
  });

  it("точное совпадение slug имеет приоритет", () => {
    expect(resolveCategoryHref(REAL_CATS, "meditsinskie-kostyumy")).toBe(
      "/catalog?category=meditsinskie-kostyumy",
    );
  });

  it("пустое дерево → всегда /catalog (никаких битых ссылок)", () => {
    expect(resolveCategoryHref([], "women")).toBe("/catalog");
    expect(resolveCategoryHref([], "suits")).toBe("/catalog");
  });

  it("неизвестная тема без паттерна → /catalog", () => {
    expect(resolveCategoryHref(REAL_CATS, "zzz-unknown")).toBe("/catalog");
  });

  it("совпадение по ИМЕНИ категории (английский каталог)", () => {
    const en: AdmikCategoryDto[] = [
      { slug: "tops", name: "Women's Scrubs", description: "", children: [] },
    ];
    expect(resolveCategoryHref(en, "women")).toBe("/catalog?category=tops");
  });
});

describe("topCategoryLinks — плитки «Категории» на главной", () => {
  it("ТОЛЬКО верхний уровень: подкатегории не подмешиваются", () => {
    // Отличие от categoryLinks (DFS): «Хирургические (жен)/(муж)» — дети, в
    // плитки они попасть не должны, иначе ребёнок встанет рядом с родителем.
    expect(topCategoryLinks(REAL_CATS, 6)).toEqual([
      {
        slug: "meditsinskie-kostyumy",
        name: "Медицинские костюмы",
        description: "",
        href: "/catalog?category=meditsinskie-kostyumy",
      },
      {
        slug: "hirurgicheskie-operatsionnye",
        name: "Хирургические (операционные)",
        description: "",
        href: "/catalog?category=hirurgicheskie-operatsionnye",
      },
    ]);
  });

  it("ограничение max режет лишние плитки", () => {
    expect(topCategoryLinks(REAL_CATS, 1).map((l) => l.slug)).toEqual([
      "meditsinskie-kostyumy",
    ]);
  });

  it("пустое дерево → пустой массив (секция скрывается целиком)", () => {
    expect(topCategoryLinks([], 3)).toEqual([]);
  });

  it("description пробрасывается: заменяет выдуманные статы «3 кроя»", () => {
    const cats: AdmikCategoryDto[] = [
      { slug: "halaty", name: "Халаты", description: "4 длины", children: [] },
    ];
    expect(topCategoryLinks(cats, 3)[0].description).toBe("4 длины");
  });

  it("max <= 0 → пусто (не роняем на отрицательном)", () => {
    expect(topCategoryLinks(REAL_CATS, 0)).toEqual([]);
    expect(topCategoryLinks(REAL_CATS, -5)).toEqual([]);
  });
});

describe("categoryLinks — реальные категории ссылками (главная/футер)", () => {
  it("плоский DFS: топ + дети, href по slug, до max", () => {
    expect(categoryLinks(REAL_CATS, 6)).toEqual([
      { slug: "meditsinskie-kostyumy", name: "Медицинские костюмы", href: "/catalog?category=meditsinskie-kostyumy" },
      { slug: "hirurgicheskie-operatsionnye", name: "Хирургические (операционные)", href: "/catalog?category=hirurgicheskie-operatsionnye" },
      { slug: "hirurgicheskie-zhen", name: "Хирургические (жен)", href: "/catalog?category=hirurgicheskie-zhen" },
      { slug: "hirurgicheskie-muzh", name: "Хирургические (муж)", href: "/catalog?category=hirurgicheskie-muzh" },
    ]);
  });

  it("ограничение max", () => {
    expect(categoryLinks(REAL_CATS, 2).map((l) => l.slug)).toEqual([
      "meditsinskie-kostyumy",
      "hirurgicheskie-operatsionnye",
    ]);
  });

  it("пустое дерево → []", () => {
    expect(categoryLinks([])).toEqual([]);
  });
});

describe("topLevelAncestorSlug", () => {
  const tree: AdmikCategoryDto[] = [
    {
      slug: "women",
      name: "Женское",
      description: "",
      children: [
        { slug: "women-halaty", name: "Халаты", description: "", children: [] },
        {
          slug: "women-kostyumy",
          name: "Костюмы",
          description: "",
          children: [
            { slug: "women-scrubs", name: "Скрабы", description: "", children: [] },
          ],
        },
      ],
    },
    { slug: "men", name: "Мужское", description: "", children: [] },
  ];

  it("пустой активный slug («Все») → \"\"", () => {
    expect(topLevelAncestorSlug(tree, "")).toBe("");
  });

  it("активна категория верхнего уровня → она сама", () => {
    expect(topLevelAncestorSlug(tree, "women")).toBe("women");
    expect(topLevelAncestorSlug(tree, "men")).toBe("men");
  });

  it("активна прямая подкатегория → top-level предок", () => {
    expect(topLevelAncestorSlug(tree, "women-halaty")).toBe("women");
    expect(topLevelAncestorSlug(tree, "women-kostyumy")).toBe("women");
  });

  it("активна вложенная подкатегория (глубина 2) → top-level предок", () => {
    expect(topLevelAncestorSlug(tree, "women-scrubs")).toBe("women");
  });

  it("неизвестный slug → \"\" (ни один таб не подсвечен)", () => {
    expect(topLevelAncestorSlug(tree, "no-such")).toBe("");
  });

  it("пустое дерево → \"\"", () => {
    expect(topLevelAncestorSlug([], "women")).toBe("");
  });
});

describe("flattenCategoryNav", () => {
  it("пустое дерево → []", () => {
    expect(flattenCategoryNav([])).toEqual([]);
  });

  it("топ-уровень → ссылки на /catalog?category=<slug> без отступа", () => {
    const cats: AdmikCategoryDto[] = [
      { slug: "halaty", name: "Халаты", description: "", children: [] },
      { slug: "kostyumy", name: "Костюмы", description: "", children: [] },
    ];
    expect(flattenCategoryNav(cats)).toEqual([
      { href: "/catalog?category=halaty", label: "Халаты" },
      { href: "/catalog?category=kostyumy", label: "Костюмы" },
    ]);
  });

  it("вложенные категории в порядке обхода в глубину, дети с префиксом «— »", () => {
    const cats: AdmikCategoryDto[] = [
      {
        slug: "women",
        name: "Женское",
        description: "",
        children: [
          { slug: "women-halaty", name: "Халаты", description: "", children: [] },
          {
            slug: "women-kostyumy",
            name: "Костюмы",
            description: "",
            children: [
              { slug: "women-scrubs", name: "Скрабы", description: "", children: [] },
            ],
          },
        ],
      },
      { slug: "men", name: "Мужское", description: "", children: [] },
    ];
    expect(flattenCategoryNav(cats)).toEqual([
      { href: "/catalog?category=women", label: "Женское" },
      { href: "/catalog?category=women-halaty", label: "— Халаты" },
      { href: "/catalog?category=women-kostyumy", label: "— Костюмы" },
      { href: "/catalog?category=women-scrubs", label: "— — Скрабы" },
      { href: "/catalog?category=men", label: "Мужское" },
    ]);
  });

  it("экранирует slug в href (encodeURIComponent)", () => {
    const cats: AdmikCategoryDto[] = [
      { slug: "a b&c", name: "Спорные", description: "", children: [] },
    ];
    expect(flattenCategoryNav(cats)[0].href).toBe("/catalog?category=a%20b%26c");
  });
});

describe("sortProducts", () => {
  const products = [
    mk({ slug: "a", price: 3000, isNew: false, isBestseller: true }),
    mk({ slug: "b", price: 1000, isNew: true, isBestseller: false }),
    mk({ slug: "c", price: 2000, isNew: false, isBestseller: true }),
  ];

  it("default — без изменения порядка", () => {
    expect(sortProducts(products, "default").map((p) => p.slug)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("price-asc — по возрастанию цены", () => {
    expect(sortProducts(products, "price-asc").map((p) => p.price)).toEqual([
      1000, 2000, 3000,
    ]);
  });

  it("price-desc — по убыванию цены", () => {
    expect(sortProducts(products, "price-desc").map((p) => p.price)).toEqual([
      3000, 2000, 1000,
    ]);
  });

  it("new — новинки впереди", () => {
    expect(sortProducts(products, "new")[0].slug).toBe("b");
  });

  it("bestseller — бестселлеры впереди, остальные сохранены (НЕ удаляются)", () => {
    // Сортировка не должна вырезать товары из выдачи (это контрол СОРТИРОВКИ,
    // а не фильтр): a и c — бестселлеры, идут первыми (стабильно), b — после.
    const out = sortProducts(products, "bestseller");
    expect(out.map((p) => p.slug)).toEqual(["a", "c", "b"]);
    expect(out).toHaveLength(products.length);
  });

  it("не мутирует исходный массив", () => {
    const copy = [...products];
    sortProducts(products, "price-asc");
    expect(products).toEqual(copy);
  });
});

describe("buildCatalogHref / removeFacet — управление фасетами URL (C22)", () => {
  it("пустые параметры → /catalog", () => {
    expect(buildCatalogHref({})).toBe("/catalog");
  });

  it("только распродажа → /catalog?sale=1", () => {
    expect(buildCatalogHref({ sale: true })).toBe("/catalog?sale=1");
  });

  it("категория + оба фасета сохраняются (порядок зафиксирован)", () => {
    expect(buildCatalogHref({ category: "women", sale: true, isNew: true })).toBe(
      "/catalog?category=women&sale=1&new=1",
    );
  });

  it("q пробрасывается с encodeURIComponent", () => {
    expect(buildCatalogHref({ q: "белый халат" })).toBe(
      "/catalog?q=%D0%B1%D0%B5%D0%BB%D1%8B%D0%B9%20%D1%85%D0%B0%D0%BB%D0%B0%D1%82",
    );
  });

  it("removeFacet снимает один фасет, сохраняя остальные", () => {
    expect(removeFacet({ category: "women", sale: true, isNew: true }, "sale")).toBe(
      "/catalog?category=women&new=1",
    );
  });

  it("снятие последнего фасета даёт чистый /catalog", () => {
    expect(removeFacet({ sale: true }, "sale")).toBe("/catalog");
  });
});

describe("applyCatalogView", () => {
  const products = [
    mk({ slug: "a", price: 3000, isNew: false, isBestseller: true }),
    mk({ slug: "b", price: 1000, isNew: true, isBestseller: false }),
    mk({ slug: "c", price: 5000, isNew: true, isBestseller: true }),
  ];

  it("порог цены отсекает дороже priceMax", () => {
    const out = applyCatalogView(products, {
      priceMax: 3000,
      onlyNew: false,
      onlyBestseller: false,
      sort: "default",
    });
    expect(out.map((p) => p.slug)).toEqual(["a", "b"]);
  });

  describe("фасеты пол/цвет/размер (Мадина №5)", () => {
    const faceted = [
      mk({ slug: "ordo", gender: "women", color: "Белый", sizes: ["42 / XS", "44 / S"] }),
      mk({ slug: "altera", gender: "men", color: "Графит", sizes: ["48 / M", "50 / L"] }),
    ];
    const base = { priceMax: 999999, onlyNew: false, onlyBestseller: false, sort: "default" as const };

    it("пустые фасеты не ограничивают", () => {
      expect(applyCatalogView(faceted, base).map((p) => p.slug)).toEqual(["ordo", "altera"]);
    });
    it("фильтр по полу", () => {
      expect(applyCatalogView(faceted, { ...base, genders: ["women"] }).map((p) => p.slug)).toEqual(["ordo"]);
    });
    it("фильтр по цвету (регистронезависимо)", () => {
      expect(applyCatalogView(faceted, { ...base, colors: ["графит"] }).map((p) => p.slug)).toEqual(["altera"]);
    });
    it("фильтр по размеру (товар содержит любой из выбранных)", () => {
      expect(applyCatalogView(faceted, { ...base, sizes: ["48 / M"] }).map((p) => p.slug)).toEqual(["altera"]);
    });
    it("несколько фасетов = AND между ними", () => {
      expect(applyCatalogView(faceted, { ...base, genders: ["women"], colors: ["графит"] })).toHaveLength(0);
    });
  });

  it("чекбокс Новинки + сортировка по цене", () => {
    const out = applyCatalogView(products, {
      priceMax: 10000,
      onlyNew: true,
      onlyBestseller: false,
      sort: "price-asc",
    });
    expect(out.map((p) => p.slug)).toEqual(["b", "c"]);
  });

  it("чекбокс Bestsellers совместно с порогом цены", () => {
    const out = applyCatalogView(products, {
      priceMax: 4000,
      onlyNew: false,
      onlyBestseller: true,
      sort: "default",
    });
    expect(out.map((p) => p.slug)).toEqual(["a"]);
  });
});
