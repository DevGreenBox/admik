"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart, Minus, Plus } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { StorefrontProduct, StorefrontVariant } from "@/lib/admik";
import { Button } from "@/components/ui/Button";
import { FadeIn } from "@/components/ui/Animations";
import { ProductCard } from "@/components/catalog/ProductCard";
import { ProductGallery } from "@/components/product/ProductGallery";
import { SizeGuide } from "@/components/product/SizeGuide";
import { StickyAddToCart } from "@/components/product/StickyAddToCart";
import { HEADER_OFFSET } from "@/components/layout/Header";

interface ProductDetailClientProps {
  product: StorefrontProduct;
  related: StorefrontProduct[];
}

export function ProductDetailClient({ product, related }: ProductDetailClientProps) {
  const [selectedVariant, setSelectedVariant] = useState<StorefrontVariant | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const addToCart = useStore((s) => s.addToCart);
  const toggleWishlist = useStore((s) => s.toggleWishlist);
  const isInWishlist = useStore((s) => s.isInWishlist(product.slug));

  const hasVariants = product.variants.length > 0;
  const selectedSize = selectedVariant?.size ?? null;
  // Есть ли хоть один размер в наличии (иначе кнопка должна честно сказать
  // «Нет в наличии», а не «Выберите размер» — выбирать нечего).
  const hasAvailableVariants = product.variants.some((v) => v.inStock);
  // Товар БЕЗ вариантов (один SKU): покупаем по productId, если есть остаток.
  const canBuySimple = !hasVariants && product.inStock && Boolean(product.id);
  const canBuy = hasVariants ? Boolean(selectedVariant) : canBuySimple;

  const handleAddToCart = () => {
    if (!canBuy) return;
    if (hasVariants && selectedVariant) {
      addToCart(
        {
          variantId: selectedVariant.id,
          slug: product.slug,
          name: product.name,
          size: selectedVariant.size,
          price: selectedVariant.price,
          imageUrl: product.imageUrl,
        },
        quantity
      );
    } else if (canBuySimple && product.id) {
      // variantId = id товара (ключ позиции), productId = id товара (для Admik).
      addToCart(
        {
          variantId: product.id,
          productId: product.id,
          slug: product.slug,
          name: product.name,
          size: "",
          price: product.price,
          imageUrl: product.imageUrl,
        },
        quantity
      );
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div className={`page-transition ${HEADER_OFFSET} pb-24 md:pb-0`}>
      <div className="container-brand py-10 md:py-16 lg:py-20">
        <FadeIn>
          <nav className="text-[10px] uppercase tracking-[0.2em] text-muted mb-12 md:mb-16">
            <Link href="/catalog" className="hover:text-graphite transition-colors duration-500">Коллекция</Link>
            <span className="mx-4">/</span>
            <span className="text-graphite">{product.name}</span>
          </nav>
        </FadeIn>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 xl:gap-12">
          <FadeIn direction="left" className="lg:col-span-7">
            <ProductGallery images={product.images} name={product.name} />
          </FadeIn>

          <FadeIn direction="right" delay={0.15} className="lg:col-span-4 lg:col-start-9">
            <div className="lg:sticky lg:top-32 lg:self-start space-y-8 md:space-y-10">
              <div>
                {product.isNew && (
                  <p className="eyebrow mb-4">New</p>
                )}
                <h1 className="heading-lg heading-rule">{product.name}</h1>
              </div>

              <p className="text-base md:text-lg tracking-[0.06em] tabular-nums">{formatPrice(product.price)}</p>
              {product.description && (
                <p className="body-editorial">{product.description}</p>
              )}

              {/* Размер — только для товаров с вариантами. */}
              {hasVariants && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[10px] uppercase tracking-[0.2em]">
                      Размер {!selectedVariant && <span className="text-muted">*</span>}
                    </p>
                    <SizeGuide gender={product.gender} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {product.variants.map((variant) => (
                      <button
                        key={variant.id}
                        disabled={!variant.inStock}
                        onClick={() => setSelectedVariant(variant)}
                        className={`min-w-[48px] px-4 py-3 text-[10px] uppercase tracking-[0.15em] border transition-all duration-500 disabled:opacity-30 disabled:cursor-not-allowed ${
                          selectedVariant?.id === variant.id
                            ? "border-graphite bg-graphite text-white"
                            : "border-border hover:border-graphite"
                        }`}
                      >
                        {variant.size}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Количество — для всего, что можно купить (с размерами или без). */}
              {(hasVariants || canBuySimple) && (
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] mb-4">Количество</p>
                  <div className="inline-flex items-center border border-border">
                    <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="p-3 hover:opacity-50 transition-opacity duration-500" aria-label="Уменьшить">
                      <Minus className="h-4 w-4" strokeWidth={1} />
                    </button>
                    <span className="px-8 text-sm tabular-nums">{quantity}</span>
                    <button onClick={() => setQuantity(quantity + 1)} className="p-3 hover:opacity-50 transition-opacity duration-500" aria-label="Увеличить">
                      <Plus className="h-4 w-4" strokeWidth={1} />
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  variant="primary"
                  size="lg"
                  disabled={!canBuy}
                  onClick={handleAddToCart}
                  className="flex-1"
                >
                  {added
                    ? "Добавлено"
                    : !hasVariants && !canBuySimple
                      ? "Нет в наличии"
                      : hasVariants && !hasAvailableVariants
                        ? "Нет в наличии"
                        : hasVariants && !selectedVariant
                          ? "Выберите размер"
                          : "В корзину"}
                </Button>
                <button
                  onClick={() => toggleWishlist(product.slug)}
                  className="p-4 border border-border hover:border-graphite transition-colors duration-500"
                  aria-label="В избранное"
                >
                  <Heart className={`h-5 w-5 ${isInWishlist ? "fill-graphite text-graphite" : ""}`} strokeWidth={1} />
                </button>
              </div>

              <div className="space-y-6 border-t border-border pt-10">
                {product.composition && <Detail label="Состав" value={product.composition} />}
                {product.care && <Detail label="Уход" value={product.care} />}
                {product.color && <Detail label="Цвет" value={product.color} />}
                {product.features.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted mb-3">Детали</p>
                    <ul className="space-y-2">
                      {product.features.map((f) => (
                        <li key={f} className="text-sm text-muted leading-relaxed">
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </FadeIn>
        </div>

        {related.length > 0 && (
          <section className="mt-32 md:mt-40 lg:mt-48">
            <FadeIn>
              <p className="eyebrow mb-6">Selection</p>
              <h2 className="heading-md mb-14 md:mb-20">Рекомендуем</h2>
            </FadeIn>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-12 md:gap-x-6 md:gap-y-16 lg:gap-x-8 lg:gap-y-20">
              {related.map((p) => (
                <ProductCard key={p.slug} product={p} />
              ))}
            </div>
          </section>
        )}
      </div>

      <StickyAddToCart
        name={product.name}
        price={product.price}
        selectedSize={selectedSize}
        onAddToCart={handleAddToCart}
        disabled={!canBuy}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted mb-1">{label}</p>
      <p className="text-sm leading-relaxed">{value}</p>
    </div>
  );
}
