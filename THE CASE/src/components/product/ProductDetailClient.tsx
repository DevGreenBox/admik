"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Heart, Minus, Plus } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { productCtaLabel } from "@/lib/product-cta";
import { brandLabel } from "@/lib/brand-label";
import { variantUnavailableLabel } from "@/lib/variant-availability";
import { colorHex } from "@/lib/color-swatch";
import {
  clampQuantity,
  colorUnavailableLabel,
  listColors,
  listSizes,
  selectColor,
  selectSize,
  type ResolvedSelection,
} from "@/lib/variant-matrix";
import { useStore, useHydrated } from "@/lib/store";
import type { StorefrontProduct, StorefrontVariant } from "@/lib/admik";
import type { SizeChartsSettings } from "@/lib/size-table";
import { Button } from "@/components/ui/Button";
import { FadeIn } from "@/components/ui/Animations";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { ProductCard } from "@/components/catalog/ProductCard";
import { ProductGallery } from "@/components/product/ProductGallery";
import { SizeGuide } from "@/components/product/SizeGuide";
import { StickyAddToCart } from "@/components/product/StickyAddToCart";
import { HEADER_OFFSET } from "@/components/layout/Header";

interface ProductDetailClientProps {
  product: StorefrontProduct;
  related: StorefrontProduct[];
  /** Размерные сетки из настроек магазина (settings.sizeCharts). Приходят с
   *  сервера вместе со страницей — отдельного запроса за таблицей нет. */
  sizeCharts?: SizeChartsSettings | null;
}

// Дефолты «Состав и уход» / описания (правки клиента): показываются, если у
// товара поля не заполнены в админке (когда заполнены — берётся значение товара).
const DEFAULT_DESCRIPTION =
  "Современная, стильная и модная одежда премиум класса для врачей и среднего медицинского персонала.";
const DEFAULT_COMPOSITION = "72% полиэфир, 21% вискоза, 7% спандекс";
const DEFAULT_CARE =
  "Вывернуть одежду наизнанку и стирать при температуре воды не выше 30 °С с вещами аналогичного цвета. " +
  "Не подвергать химической чистке и не отбеливать. Гладить с изнаночной стороны при температуре не выше 110 °С.";


export function ProductDetailClient({ product, related, sizeCharts }: ProductDetailClientProps) {
  // Оси выбора: цвет × размер. Вся логика — в чистом модуле variant-matrix
  // (покрыт юнит-тестами), здесь только разметка и состояние.
  const colorOptions = useMemo(
    () => listColors(product.variants, product.colors),
    [product.variants, product.colors],
  );

  const [selection, setSelection] = useState<ResolvedSelection<StorefrontVariant>>(() =>
    // Цвет один — выбирать нечего, ставим его сразу (иначе кнопка размера
    // не смогла бы разрешить вариант, а свотч выглядел бы «не выбран»).
    colorOptions.length === 1
      ? selectColor(product.variants, { color: null, size: null }, colorOptions[0].value)
      : { color: null, size: null, variant: null },
  );
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const selectedVariant = selection.variant;
  // Размеры — в разрезе выбранного цвета: комбинация, которой нет или которой
  // нет в наличии, приходит сюда с available = false и дизейблится.
  const sizeOptions = useMemo(
    () => listSizes(product.variants, selection.color),
    [product.variants, selection.color],
  );

  /** Применяет новый выбор: сбрасывает «Добавлено» и синхронизирует количество. */
  const applySelection = (next: ResolvedSelection<StorefrontVariant>) => {
    setSelection(next);
    setAdded(false);
    // Смена цвета может обнулить выбранный вариант (размера нет в новом цвете) —
    // тогда количество возвращается к 1, иначе режется по остатку нового варианта.
    setQuantity((q) => clampQuantity(q, next.variant));
  };

  const addToCart = useStore((s) => s.addToCart);
  const toggleWishlist = useStore((s) => s.toggleWishlist);
  // Заливка «сердечка» зависит от persist-вишлиста (localStorage). До регидрации
  // держим серверное состояние (не залито), затем показываем реальное — тот же
  // защитный паттерн, что в ProductCard (см. useHydrated): консистентность + без
  // мерцания заливки. Реального #418 здесь нет (skipHydration + rehydrate в useEffect).
  const isInWishlistRaw = useStore((s) => s.isInWishlist(product.slug));
  const hydrated = useHydrated();
  const isInWishlist = hydrated && isInWishlistRaw;

  const hasVariants = product.variants.length > 0;
  // Бренд товара (C23) — плейн-текст над названием; null, если бренд не задан.
  const brand = brandLabel(product);
  const selectedSize = selection.size;
  // Есть ли хоть один размер в наличии (иначе кнопка должна честно сказать
  // «Нет в наличии», а не «Выберите размер» — выбирать нечего).
  const hasAvailableVariants = product.variants.some((v) => v.inStock);
  // Товар БЕЗ вариантов (один SKU): покупаем по productId, если есть остаток.
  const canBuySimple = !hasVariants && product.inStock && Boolean(product.id);
  // Вариант мог разрешиться в распроданную комбинацию (единственное совпадение
  // пары цвет×размер) — покупку в этом случае не открываем.
  const canBuy = hasVariants
    ? Boolean(selectedVariant && selectedVariant.inStock && selectedVariant.availableQty > 0)
    : canBuySimple;
  // Единая подпись кнопки покупки — общая для основной и плавающей кнопки.
  const ctaLabel = productCtaLabel({
    added,
    hasVariants,
    canBuySimple,
    hasAvailableVariants,
    hasSelectedVariant: Boolean(selectedVariant),
    needsColor: colorOptions.length > 0 && selection.color === null,
  });

  // Цена к покупке: выбранного варианта, иначе базовая товара. Используется и в
  // отображении, и в позиции корзины — чтобы показанная цена совпала с добавленной.
  const activePrice = selectedVariant?.price ?? product.price;

  // Скидку (старая цена + бейдж) показываем только когда отображается базовая цена
  // товара: compareAtPrice смаппен на уровне товара (oldPrice/onSale/discountPct),
  // а у выбранного варианта может быть своя цена — тогда не сравниваем со старой
  // базовой, чтобы не вводить в заблуждение (показываем чистую цену варианта).
  const showBasePriceSale = activePrice === product.price;

  // Доступный к заказу остаток текущей покупки: выбранного варианта, иначе товара
  // (для товара без вариантов). null = неизвестно (нечего покупать) → без лимита.
  // Ограничивает счётчик количества, чтобы нельзя было заказать больше остатка
  // (бэкенд — последняя линия обороны, но UI не даёт превысить заранее).
  const activeAvailable: number | null = hasVariants
    ? selectedVariant?.availableQty ?? null
    : canBuySimple
      ? product.availableQty
      : null;

  const handleAddToCart = () => {
    if (!canBuy) return;
    if (added) return; // не плодим дубль позиции, пока показывается «Добавлено»
    if (hasVariants && selectedVariant) {
      addToCart(
        {
          variantId: selectedVariant.id,
          slug: product.slug,
          name: product.name,
          size: selectedVariant.size,
          // Опционально: у товара без цветовой оси поля просто не будет.
          color: selectedVariant.color ?? undefined,
          price: selectedVariant.price,
          imageUrl: product.imageUrl,
          available: selectedVariant.availableQty,
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
          available: product.availableQty,
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
                  <p className="eyebrow mb-4">Новинка</p>
                )}
                {brand && <p className="eyebrow text-muted mb-2">{brand}</p>}
                <h1 className="heading-lg heading-rule">{product.name}</h1>
              </div>

              <div className="text-base md:text-lg tracking-[0.06em]">
                {showBasePriceSale ? (
                  <PriceDisplay product={product} className="text-base md:text-lg tracking-[0.06em]" />
                ) : (
                  <span className="tabular-nums">{formatPrice(activePrice)}</span>
                )}
              </div>
              <p className="body-editorial">{product.description || DEFAULT_DESCRIPTION}</p>

              {/* Цвет = вариантная ось: настоящий выбор свотчем (стиль — как в
                  фильтре каталога). Распроданный цвет дизейблится с причиной. */}
              {colorOptions.length > 0 && (
                <div>
                  <p className="mb-4 text-[10px] uppercase tracking-[0.2em]">
                    Цвет{" "}
                    {selection.color ? (
                      <span className="text-muted">: {selection.color}</span>
                    ) : (
                      <span className="text-muted">*</span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-3" role="group" aria-label="Цвет">
                    {colorOptions.map((option) => {
                      const on = option.value === selection.color;
                      // Причина недоступности — в title + aria-label: приглушённая
                      // кнопка иначе озвучивается лишь как «dimmed» (ср. C28).
                      const reason = colorUnavailableLabel(option);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={!option.available}
                          aria-pressed={on}
                          aria-label={reason ?? option.value}
                          title={reason ?? option.value}
                          onClick={() =>
                            applySelection(selectColor(product.variants, selection, option.value))
                          }
                          className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors duration-500 disabled:opacity-30 disabled:cursor-not-allowed ${
                            on ? "border-graphite" : "border-border hover:border-graphite"
                          }`}
                        >
                          <span
                            className="h-6 w-6 rounded-full border border-border"
                            style={{ backgroundColor: colorHex(option.value, option.hex) }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Размер — только для товаров с вариантами. */}
              {hasVariants && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[10px] uppercase tracking-[0.2em]">
                      Размер {!selection.size && <span className="text-muted">*</span>}
                    </p>
                    <SizeGuide
                      charts={sizeCharts?.charts}
                      gender={product.gender}
                      footnote={sizeCharts?.footnote}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Размер">
                    {sizeOptions.map((option) => {
                      // C28: причина недоступности размера → title + aria-label, чтобы
                      // приглушённая кнопка озвучивалась скринридером не просто как
                      // «dimmed», а с причиной (title один не закрывает touch-устройства).
                      // Доступность считается в паре с выбранным цветом.
                      const reason = variantUnavailableLabel({
                        size: option.size,
                        inStock: option.available,
                      });
                      const on = option.size === selection.size;
                      return (
                        <button
                          key={option.size}
                          type="button"
                          disabled={!option.available}
                          aria-pressed={on}
                          title={reason ?? undefined}
                          aria-label={reason ?? undefined}
                          onClick={() =>
                            applySelection(selectSize(product.variants, selection, option.size))
                          }
                          className={`min-w-[48px] px-4 py-3 text-[10px] uppercase tracking-[0.15em] border transition-all duration-500 disabled:opacity-30 disabled:cursor-not-allowed disabled:line-through ${
                            on
                              ? "border-graphite bg-graphite text-white"
                              : "border-border hover:border-graphite"
                          }`}
                        >
                          {option.size}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Товар без вариантов тоже должен показывать таблицу размеров: у него
                  нет блока «Размер», где живёт кнопка, поэтому рендерим её отдельно.
                  Компонент сам ничего не отрисует, если сеток в настройках нет. */}
              {!hasVariants && (
                <div>
                  <SizeGuide
                    charts={sizeCharts?.charts}
                    gender={product.gender}
                    footnote={sizeCharts?.footnote}
                  />
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
                    <button
                      onClick={() => setQuantity(activeAvailable == null ? quantity + 1 : Math.min(activeAvailable, quantity + 1))}
                      disabled={activeAvailable != null && quantity >= activeAvailable}
                      className="p-3 hover:opacity-50 transition-opacity duration-500 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Увеличить"
                    >
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
                  {ctaLabel}
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
                <p className="text-[10px] uppercase tracking-[0.2em] text-graphite">Состав и уход</p>
                <Detail label="Состав" value={product.composition || DEFAULT_COMPOSITION} />
                <Detail label="Рекомендации по уходу" value={product.care || DEFAULT_CARE} />
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
              <p className="eyebrow mb-6">Подборка</p>
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
        price={activePrice}
        selectedColor={selection.color}
        selectedSize={selectedSize}
        ctaLabel={ctaLabel}
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
