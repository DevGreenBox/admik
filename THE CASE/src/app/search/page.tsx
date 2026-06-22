"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import { listProducts, fromListItem, type StorefrontProduct } from "@/lib/admik";
import { ProductCard } from "@/components/catalog/ProductCard";
import { FadeIn } from "@/components/ui/Animations";
import { pluralRu } from "@/lib/plural";

// Лимит результатов поиска — как в каталоге (без лимита бэкенд отдавал страницу по
// умолчанию ~24, а подпись выдавала её размер за итог). Для магазина уровня THE CASE
// 60 покрывает весь каталог; подпись честно отражает число показанных результатов.
const SEARCH_LIMIT = 60;

function SearchContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<StorefrontProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      listProducts({ q, limit: SEARCH_LIMIT })
        .then((items) => {
          if (!cancelled) setResults(items.map(fromListItem));
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="container-brand py-12 md:py-16">
        <FadeIn>
          <h1 className="heading-lg heading-rule mb-8">Поиск</h1>

          <div className="relative max-w-xl mb-12">
            <SearchIcon
              className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted"
              strokeWidth={1.5}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название, категория, цвет..."
              autoFocus
              className="w-full border border-border pl-12 pr-4 py-4 text-sm focus:border-graphite outline-none transition-colors"
            />
          </div>
        </FadeIn>

        {query.trim().length >= 2 && (
          <>
            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-10">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton aspect-[3/4]" />
                ))}
              </div>
            ) : (
              <>
                <p className="text-sm text-muted mb-8">
                  {results.length}{" "}
                  {pluralRu(results.length, ["результат", "результата", "результатов"])} по запросу «{query}»
                </p>

                {results.length === 0 ? (
                  <FadeIn>
                    <div className="text-center py-16">
                      <p className="heading-md text-muted mb-4">Ничего не найдено</p>
                      <Link
                        href="/catalog"
                        className="text-[11px] uppercase tracking-[0.12em] link-underline"
                      >
                        Перейти в каталог
                      </Link>
                    </div>
                  </FadeIn>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-10">
                    {results.map((product) => (
                      <ProductCard key={product.slug} product={product} />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {query.trim().length < 2 && (
          <p className="text-sm text-muted">
            Введите минимум 2 символа для поиска
          </p>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="skeleton h-32 m-16" />}>
      <SearchContent />
    </Suspense>
  );
}
