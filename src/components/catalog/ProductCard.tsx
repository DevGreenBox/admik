"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { BESTSELLER_HOVER } from "@/lib/images";
import { useStore } from "@/lib/store";
import {
  getProduct,
  fromDetail,
  type StorefrontProduct,
  type StorefrontVariant,
} from "@/lib/admik";
import { Button } from "@/components/ui/Button";
import { FadeIn } from "@/components/ui/Animations";
import { LuxuryImageSwap } from "@/components/ui/LuxuryImageSwap";

interface ProductCardProps {
  product: StorefrontProduct;
  priority?: boolean;
  size?: "default" | "large";
}

export function ProductCard({ product, priority = false, size = "default" }: ProductCardProps) {
  const toggleWishlist = useStore((s) => s.toggleWishlist);
  const isInWishlist = useStore((s) => s.isInWishlist(product.slug));
  const [quickView, setQuickView] = useState(false);

  const imageSizes = size === "large" ? "50vw" : "(max-width: 768px) 50vw, 25vw";

  return (
    <>
      <FadeIn className="group">
        <div>
          <Link href={`/product/${product.slug}`} className="block">
            <LuxuryImageSwap
              primary={product.images[0]}
              secondary={product.images[1]}
              alt={product.name}
              priority={priority}
              sizes={imageSizes}
              className={`bg-surface ${size === "large" ? "aspect-[3/4]" : "aspect-[3/4]"}`}
            />
          </Link>

          <div className="mt-6 md:mt-7 flex justify-between items-start gap-6">
            <div className="min-w-0">
              <Link href={`/product/${product.slug}`}>
                <h3 className="label-caps text-graphite hover:opacity-60 transition-opacity duration-700 truncate">
                  {product.name}
                </h3>
              </Link>
              {product.isNew && (
                <p className="label-caps text-muted mt-2.5 text-[9px] tracking-[0.26em]">New</p>
              )}
            </div>
            <p className="text-[11px] tracking-[0.1em] shrink-0 tabular-nums">{formatPrice(product.price)}</p>
          </div>

          <div className="mt-4 flex gap-5 opacity-0 group-hover:opacity-100 transition-opacity duration-700">
            <button
              onClick={() => toggleWishlist(product.slug)}
              className="text-[9px] uppercase tracking-[0.22em] text-muted hover:text-graphite transition-colors"
              aria-label="В избранное"
            >
              {isInWishlist ? "В избранном" : "Избранное"}
            </button>
            <button
              onClick={() => setQuickView(true)}
              className="text-[9px] uppercase tracking-[0.22em] text-muted hover:text-graphite transition-colors"
            >
              Быстрый просмотр
            </button>
          </div>
        </div>
      </FadeIn>

      <QuickViewModal product={product} open={quickView} onClose={() => setQuickView(false)} />
    </>
  );
}

function QuickViewModal({
  product,
  open,
  onClose,
}: {
  product: StorefrontProduct;
  open: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<StorefrontProduct | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<StorefrontVariant | null>(null);
  const addToCart = useStore((s) => s.addToCart);

  useEffect(() => {
    if (!open) return;
    setSelectedVariant(null);
    let cancelled = false;
    setLoading(true);
    getProduct(product.slug)
      .then((dto) => {
        if (cancelled) return;
        setDetail(dto ? fromDetail(dto) : null);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, product.slug]);

  // Полная карточка (из API) при наличии, иначе списочный снимок.
  const view = detail ?? product;

  const handleAdd = () => {
    if (!selectedVariant) return;
    addToCart({
      variantId: selectedVariant.id,
      slug: view.slug,
      name: view.name,
      size: selectedVariant.size,
      price: selectedVariant.price,
      imageUrl: view.imageUrl,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
            className="bg-white w-full max-w-4xl max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end p-5 md:p-6">
              <button onClick={onClose} aria-label="Закрыть" className="text-muted hover:text-graphite transition-colors">
                <X className="h-5 w-5" strokeWidth={1} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 px-6 md:px-10 pb-10 md:pb-12">
              <div className="relative aspect-[3/4] bg-surface">
                {view.images[0] && (
                  <Image src={view.images[0]} alt={view.name} fill className="object-cover" />
                )}
              </div>
              <div className="flex flex-col justify-center py-2">
                <p className="eyebrow mb-5">Quick view</p>
                <h3 className="heading-md mb-5">{view.name}</h3>
                <p className="text-sm tracking-[0.08em] mb-10">{formatPrice(view.price)}</p>
                {view.description && (
                  <p className="body-editorial mb-12">{view.description}</p>
                )}

                <p className="label-caps mb-5">Размер</p>
                <div className="flex flex-wrap gap-2 mb-12 min-h-[44px]">
                  {loading ? (
                    <div className="skeleton h-11 w-full" />
                  ) : view.variants.length === 0 ? (
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted">Нет в наличии</p>
                  ) : (
                    view.variants.map((variant) => (
                      <button
                        key={variant.id}
                        disabled={!variant.inStock}
                        onClick={() => setSelectedVariant(variant)}
                        className={`min-w-[48px] px-4 py-3 text-[10px] uppercase tracking-[0.18em] border transition-all duration-500 disabled:opacity-30 disabled:cursor-not-allowed ${
                          selectedVariant?.id === variant.id
                            ? "border-graphite bg-graphite text-white"
                            : "border-border hover:border-graphite"
                        }`}
                      >
                        {variant.size}
                      </button>
                    ))
                  )}
                </div>

                <Button
                  variant="primary"
                  size="lg"
                  disabled={!selectedVariant}
                  onClick={handleAdd}
                  className="w-full"
                >
                  В корзину
                </Button>
                <Link
                  href={`/product/${view.slug}`}
                  onClick={onClose}
                  className="mt-8 text-center label-caps text-muted link-underline"
                >
                  Подробнее
                </Link>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Bestsellers({ products }: { products: StorefrontProduct[] }) {
  return (
    <section className="section-space-sm border-t border-border">
      <div className="container-brand">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-20 md:mb-28 lg:mb-32 gap-10">
          <div>
            <p className="eyebrow mb-8">Selection</p>
            <h2 className="heading-lg heading-rule">Bestsellers</h2>
          </div>
          <Link href="/catalog" className="eyebrow text-muted link-underline self-start md:self-auto">
            Вся коллекция
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-14 md:gap-x-6 md:gap-y-20 lg:gap-x-8 lg:gap-y-24">
          {products.slice(0, 4).map((product, i) => {
            const hoverPair = BESTSELLER_HOVER[i];
            return (
              <ProductCard
                key={product.slug}
                product={{
                  ...product,
                  images: hoverPair ?? [product.images[0], product.images[1] ?? product.images[0]],
                }}
                priority={i < 4}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
