"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { useStore, useHydrated } from "@/lib/store";
import { getProduct, fromDetail, type StorefrontProduct } from "@/lib/admik";
import { Button } from "@/components/ui/Button";
import { FadeIn } from "@/components/ui/Animations";
import { LuxuryImageSwap } from "@/components/ui/LuxuryImageSwap";
import { formatPrice } from "@/lib/format";

export default function WishlistPage() {
  const wishlist = useStore((s) => s.wishlist);
  const toggleWishlist = useStore((s) => s.toggleWishlist);
  const hydrated = useHydrated();
  const [products, setProducts] = useState<StorefrontProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      wishlist.map((slug) =>
        getProduct(slug)
          .then((dto) => (dto ? fromDetail(dto) : null))
          .catch(() => null)
      )
    )
      .then((items) => {
        if (cancelled) return;
        setProducts(items.filter((p): p is StorefrontProduct => p !== null));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wishlist]);

  // До регидрации (восстановления избранного) не показываем «Избранное пусто».
  if (!hydrated) {
    return <div className="page-transition pt-16 md:pt-20 min-h-[60vh]" />;
  }

  if (!loading && products.length === 0) {
    return (
      <div className="page-transition pt-16 md:pt-20 min-h-[60vh] flex items-center justify-center">
        <FadeIn className="text-center px-4">
          <Heart className="h-12 w-12 mx-auto mb-6 text-muted" strokeWidth={1} />
          <h1 className="heading-md mb-6">Избранное пусто</h1>
          <p className="body-editorial mx-auto mb-10 max-w-sm">
            Сохраняйте понравившиеся товары, нажимая на сердечко
          </p>
          <Link href="/catalog">
            <Button variant="primary" size="lg" magnetic>
              Перейти в каталог
            </Button>
          </Link>
        </FadeIn>
      </div>
    );
  }

  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="container-brand py-12 md:py-16">
        <FadeIn>
          <h1 className="heading-lg heading-rule mb-16">Избранное</h1>
        </FadeIn>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-10">
          {loading
            ? Array.from({ length: Math.max(wishlist.length, 4) }).map((_, i) => (
                <div key={i} className="skeleton aspect-[3/4]" />
              ))
            : products.map((product) => (
                <FadeIn key={product.slug}>
                  <div className="group">
                    <div className="relative">
                      <Link href={`/product/${product.slug}`} className="block">
                        <LuxuryImageSwap
                          primary={product.images[0]}
                          secondary={product.images[1]}
                          alt={product.name}
                          sizes="(max-width: 768px) 50vw, 25vw"
                          imageClassName="object-contain object-center"
                          className="aspect-[3/4] bg-surface"
                        />
                      </Link>
                      <button
                        onClick={() => toggleWishlist(product.slug)}
                        className="absolute top-4 right-4 p-2 bg-white/90"
                        aria-label="Удалить из избранного"
                      >
                        <Heart className="h-4 w-4 fill-accent text-accent" strokeWidth={1.5} />
                      </button>
                    </div>
                    <div className="mt-5 flex justify-between">
                      <h3 className="label-caps">{product.name}</h3>
                      <p className="text-[11px] tracking-[0.1em] tabular-nums">{formatPrice(product.price)}</p>
                    </div>
                  </div>
                </FadeIn>
              ))}
        </div>
      </div>
    </div>
  );
}
