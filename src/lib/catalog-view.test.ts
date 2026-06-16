import { describe, it, expect } from "vitest";
import {
  priceRange,
  categoryTabs,
  sortProducts,
  applyCatalogView,
} from "@/lib/catalog-view";
import type { StorefrontProduct, AdmikCategoryDto } from "@/lib/admik";

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

  it("bestseller — только bestseller", () => {
    expect(sortProducts(products, "bestseller").map((p) => p.slug)).toEqual([
      "a",
      "c",
    ]);
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
