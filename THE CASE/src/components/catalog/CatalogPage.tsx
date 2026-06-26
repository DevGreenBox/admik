"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { HEADER_OFFSET } from "@/components/layout/Header";
import { ProductCard } from "@/components/catalog/ProductCard";
import { FadeIn } from "@/components/ui/Animations";
import type { StorefrontProduct, AdmikCategoryDto } from "@/lib/admik";
import {
  applyCatalogView,
  buildCatalogHref,
  categoryTabs,
  priceRange,
  removeFacet,
  topLevelAncestorSlug,
  type CatalogSort,
} from "@/lib/catalog-view";

const SORT_OPTIONS: { value: CatalogSort; label: string }[] = [
  { value: "default", label: "По умолчанию" },
  { value: "price-asc", label: "Цена ↑" },
  { value: "price-desc", label: "Цена ↓" },
  { value: "new", label: "Новинки" },
  { value: "bestseller", label: "Bestsellers" },
];

interface CatalogPageProps {
  products: StorefrontProduct[];
  categories: AdmikCategoryDto[];
  /** Активная категория (slug из URL; "" = «Все»). */
  activeCategory: string;
  /** Активен серверный фасет «Распродажа» (?sale=1). */
  sale?: boolean;
  /** Активен серверный фасет «Новинки» (?new=1). */
  isNew?: boolean;
}

export function CatalogPage({
  products,
  categories,
  activeCategory,
  sale = false,
  isNew = false,
}: CatalogPageProps) {
  const router = useRouter();

  // Параметры активных серверных фасетов (для removable-чипов и сброса, C22).
  // Сохраняем категорию при снятии фасета; q не прокидывается в компонент, поэтому
  // здесь не участвует (фасеты приходят из шапки/футера, без поискового запроса).
  const facetParams = { category: activeCategory || undefined, sale, isNew };
  const hasFacets = sale || isNew;

  const tabs = useMemo(() => categoryTabs(categories), [categories]);
  // Если активна подкатегория — подсвечиваем её top-level предка (таб верхнего
  // уровня), т.к. вкладки строятся только из верхнего уровня дерева.
  const activeTabSlug = useMemo(
    () => topLevelAncestorSlug(categories, activeCategory),
    [categories, activeCategory]
  );
  const range = useMemo(() => priceRange(products), [products]);

  const [sort, setSort] = useState<CatalogSort>("default");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [priceMax, setPriceMax] = useState(range.max);
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyBestseller, setOnlyBestseller] = useState(false);

  const filtered = useMemo(
    () =>
      applyCatalogView(products, {
        priceMax: priceMax || range.max,
        onlyNew,
        onlyBestseller,
        sort,
      }),
    [products, priceMax, range.max, onlyNew, onlyBestseller, sort]
  );

  const goToCategory = (slug: string) => {
    router.push(slug ? `/catalog?category=${slug}` : "/catalog");
  };

  return (
    <div className={`page-transition ${HEADER_OFFSET}`}>
      <div className="container-brand py-10 md:py-16 pb-12 md:pb-16">
        <FadeIn>
          <p className="eyebrow mb-8">Shop</p>
          <h1 className="heading-lg heading-rule mb-6">Коллекция</h1>
          <p className="label-caps text-muted">
            {filtered.length} из {products.length}
          </p>
          {/* Removable-чипы активных серверных фасетов (C22): и индикатор, и снятие
              в один клик. Видны только когда фасет включён через URL (шапка/футер). */}
          {hasFacets && (
            <div className="flex flex-wrap gap-2 mt-5">
              {sale && (
                <button
                  onClick={() => router.push(removeFacet(facetParams, "sale"))}
                  className="inline-flex items-center gap-2 border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-graphite hover:border-graphite transition-colors duration-500"
                  aria-label="Снять фильтр «Распродажа»"
                >
                  Распродажа
                  <X className="h-3 w-3" strokeWidth={1.5} />
                </button>
              )}
              {isNew && (
                <button
                  onClick={() => router.push(removeFacet(facetParams, "isNew"))}
                  className="inline-flex items-center gap-2 border border-border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-graphite hover:border-graphite transition-colors duration-500"
                  aria-label="Снять фильтр «Новинки»"
                >
                  Новинки
                  <X className="h-3 w-3" strokeWidth={1.5} />
                </button>
              )}
            </div>
          )}
        </FadeIn>
      </div>

      <div className="sticky top-[104px] md:top-[116px] z-40 bg-white/90 backdrop-blur-sm border-y border-border">
        <div className="container-brand">
          <div className="flex items-center gap-6 md:gap-10 py-5 overflow-x-auto scrollbar-hide">
            {tabs.map((cat) => (
              <button
                key={cat.slug || "all"}
                onClick={() => goToCategory(cat.slug)}
                className={`label-caps whitespace-nowrap transition-colors duration-500 ${
                  activeCategory === cat.slug || activeTabSlug === cat.slug
                    ? "text-graphite"
                    : "text-muted hover:text-graphite"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between py-4 border-t border-border/60 gap-4">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as CatalogSort)}
              className="text-[10px] uppercase tracking-[0.2em] bg-transparent border-none outline-none cursor-pointer text-muted"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <button
              onClick={() => setFiltersOpen(true)}
              className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted hover:text-graphite transition-colors duration-500"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1} />
              Фильтры
            </button>
          </div>
        </div>
      </div>

      <div className="container-brand py-16 md:py-24 lg:py-32">
        {filtered.length === 0 ? (
          <div className="text-center py-32 md:py-40">
            <p className="heading-md text-muted mb-4">Ничего не найдено</p>
            <p className="body-editorial mx-auto">Измените фильтры</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-12 md:gap-x-6 md:gap-y-16 lg:gap-x-8 lg:gap-y-20">
            {filtered.map((product, i) => (
              <ProductCard key={product.slug} product={product} priority={i < 4} />
            ))}
          </div>
        )}
      </div>

      {filtersOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setFiltersOpen(false)} />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto p-8 md:p-10 animate-[slideIn_0.5s_ease-out]">
            <div className="flex justify-between items-center mb-12">
              <h3 className="heading-md">Фильтры</h3>
              <button onClick={() => setFiltersOpen(false)} className="text-muted hover:text-graphite">
                <X className="h-5 w-5" strokeWidth={1} />
              </button>
            </div>

            <FilterSection title={`Цена до ${(priceMax || range.max).toLocaleString("ru-RU")} ₽`}>
              <input type="range" min={range.min} max={range.max} step={500}
                value={priceMax || range.max} onChange={(e) => setPriceMax(Number(e.target.value))}
                className="w-full accent-graphite mt-2" />
            </FilterSection>

            <FilterSection title="Коллекция">
              <label className="flex items-center gap-3 py-2 text-sm cursor-pointer text-muted">
                <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} className="accent-graphite" />
                Новинки
              </label>
              <label className="flex items-center gap-3 py-2 text-sm cursor-pointer text-muted">
                <input type="checkbox" checked={onlyBestseller} onChange={(e) => setOnlyBestseller(e.target.checked)} className="accent-graphite" />
                Bestsellers
              </label>
            </FilterSection>

            <button
              onClick={() => {
                setPriceMax(range.max);
                setOnlyNew(false);
                setOnlyBestseller(false);
                // Консистентность (C22): если активны серверные фасеты — сбрасываем и
                // их (URL), а не только клиентское состояние, иначе «Сбросить» вводит
                // в заблуждение (фасет остаётся включённым).
                if (hasFacets) router.push(buildCatalogHref({ category: activeCategory || undefined }));
              }}
              className="w-full mt-8 py-4 text-[10px] uppercase tracking-[0.2em] border border-border hover:border-graphite transition-colors duration-500"
            >
              Сбросить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <p className="eyebrow mb-4">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
