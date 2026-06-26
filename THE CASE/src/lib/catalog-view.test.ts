import { describe, it, expect } from "vitest";
import {
  priceRange,
  categoryTabs,
  sortProducts,
  applyCatalogView,
  flattenCategoryNav,
  topLevelAncestorSlug,
  resolveCategoryHref,
  categoryLinks,
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
