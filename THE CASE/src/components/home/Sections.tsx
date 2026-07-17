"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { FadeIn, TextReveal } from "@/components/ui/Animations";
import { HEADER_OFFSET } from "@/components/layout/Header";
import { CategoryInfographics } from "@/components/home/CategoryInfographic";
import { ProductCard } from "@/components/catalog/ProductCard";
import { IMAGES, EDITORIAL_HOVER, categoryViewHover } from "@/lib/images";
import { LuxuryImageSwap } from "@/components/ui/LuxuryImageSwap";
import { resolveCategoryHref, splitByGender } from "@/lib/catalog-view";
import type { AdmikCategoryDto, StorefrontProduct } from "@/lib/admik";
import { HOME_FALLBACK, type ResolvedHome } from "@/lib/home-content";

/** Full-width banner — первый блок под меню (+ заголовок/подзаголовок и CTA) */
export function HomeBanner({ hero = HOME_FALLBACK.hero }: { hero?: ResolvedHome["hero"] }) {
  // Заголовок/подзаголовок обложки — из настроек Admik (Находка-17, settings.home.hero);
  // показываем оверлеем над CTA только когда владелец их задал (иначе чистая обложка).
  const hasHeading = Boolean(hero.title) || Boolean(hero.subtitle);
  // Находка #22: если удалённый фон обложки (S3/CDN) не загрузился (хост не в
  // remotePatterns или файл недоступен) — мягко падаем на локальную обложку, чтобы
  // главный экран не оставался пустым/битым.
  const [bannerFailed, setBannerFailed] = useState(false);
  const bannerSrc = bannerFailed
    ? IMAGES.home.banner
    : hero.imageUrl ?? IMAGES.home.banner;
  return (
    <section className={HEADER_OFFSET}>
      {/* Весь первый блок кликабелен → каталог; текст/заголовок и ссылка CTA — из
          настроек Admik (G-03, settings.home.hero) с фолбэком на дефолт витрины. */}
      <Link
        href={hero.ctaHref}
        aria-label={hero.ctaLabel}
        className="group relative block w-full"
      >
        <Image
          src={bannerSrc}
          alt={hero.title ?? "THE CASE — Medical Uniform"}
          width={3620}
          height={1810}
          priority
          quality={90}
          onError={() => setBannerFailed(true)}
          className="block w-full h-auto object-contain"
          sizes="100vw"
        />
        {/* Оверлей обложки: заголовок + подзаголовок (Находка-17) над CTA, по центру.
            Полупрозрачная подложка обеспечивает контраст текста на любом фото (a11y). */}
        <div className="pointer-events-none absolute inset-x-0 bottom-[6%] flex flex-col items-center gap-4 px-6 md:bottom-[8%] md:gap-6">
          {hasHeading && (
            <div className="max-w-3xl text-center">
              {hero.title && (
                <h1 className="font-display text-2xl uppercase leading-tight tracking-[0.04em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] sm:text-3xl md:text-4xl lg:text-5xl">
                  {hero.title}
                </h1>
              )}
              {hero.subtitle && (
                <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-white/85 drop-shadow-[0_1px_8px_rgba(0,0,0,0.5)] sm:text-xs md:mt-4 md:text-sm">
                  {hero.subtitle}
                </p>
              )}
            </div>
          )}
          {/* CTA на обложке — центрирован (правка клиента) */}
          <span className="inline-block bg-white/90 px-8 py-3 text-center text-[10px] uppercase tracking-[0.22em] text-graphite backdrop-blur-sm transition-colors duration-500 group-hover:bg-white md:px-10 md:py-4 md:text-[11px]">
            {hero.ctaLabel}
          </span>
        </div>
      </Link>
    </section>
  );
}

/**
 * Блок «Создано вместе с врачами» (правки клиента). Слайдер убран (правка 2):
 * «О бренде» (форма на основе предпочтений реальных докторов; место под эскизы)
 * и «Качество ткани» (характеристики) теперь СТАТИЧНЫ — фабрика идёт ниже, без
 * карусели и точек-переключателей. Заголовок и пункты «Качество ткани» — из
 * настроек Admik (G-02, settings.home.quality) с фолбэком на дефолт витрины.
 */
export function CoverSlides({ quality = HOME_FALLBACK.quality }: { quality?: ResolvedHome["quality"] }) {
  return (
    // Правка 3 + Саша-3/Аня-3: уменьшены отступы — промежуток до блока «Коллекция»
    // был слишком большим; вертикальный ритм сокращён консистентно по всей главной.
    <section className="pt-10 pb-10 md:pt-14 md:pb-12 lg:pt-16 lg:pb-16">
      <div className="container-brand">
        <FadeIn>
          <div className="grid grid-cols-1 items-center gap-10 bg-surface p-8 md:p-14 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="eyebrow mb-6">О бренде</p>
              <h2 className="heading-lg heading-rule mb-6">Создано вместе с врачами</h2>
              <p className="body-editorial">
                Каждая модель THE CASE создаётся на основе предпочтений реальных докторов —
                от посадки и карманов до тканей, выдерживающих долгие смены.
              </p>
            </div>
            {/* TODO(контент клиента): заменить плейсхолдеры на фото эскизов */}
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((n) => (
                <div key={n} className="flex aspect-[3/4] items-center justify-center bg-white">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-muted">Эскиз</span>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>

        {/* «Качество ткани» (Мадина №2): светлый фон как у других блоков + крупный
            заголовок heading-lg heading-rule (было мелкое eyebrow на тёмном градиенте
            — выбивалось из ритма главной). Тонкая фактура-переплетение поверх surface
            вместо «грязного серого». */}
        <FadeIn delay={0.1}>
          <div className="relative mt-6 overflow-hidden bg-surface px-8 py-12 md:px-14 md:py-16">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.06]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg,#2b2b2b 0 1px,transparent 1px 6px)," +
                  "repeating-linear-gradient(-45deg,#2b2b2b 0 1px,transparent 1px 6px)",
              }}
            />
            <div className="relative">
              <h2 className="heading-lg heading-rule mb-8 md:mb-10">{quality.title}</h2>
              {/* Пункты-характеристики карточками с нумерацией (каталожный ритм). */}
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {quality.items.map((f, i) => (
                  <li
                    key={f}
                    className="group border border-border bg-white p-6 transition-colors hover:border-graphite"
                  >
                    <span className="mb-4 block text-[11px] tracking-[0.2em] text-muted">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="body-editorial block text-sm text-graphite">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/** Medical Fashion — text block */
export function EditorialIntro() {
  return (
    <section className="section-space-sm pb-10 md:pb-14 lg:pb-16">
      <div className="container-brand">
        <FadeIn>
          <div className="max-w-xl mx-auto text-center py-8 md:py-12">
            <h2 className="heading-lg heading-rule mb-10">
              <TextReveal text="Medical Fashion" />
            </h2>
            <p className="body-editorial mx-auto mb-12">
              Современная медицинская форма, созданная с вниманием к деталям,
              потребностям врачей и эстетике quiet luxury.
            </p>
            <Link href="/catalog" className="link-editorial">
              Смотреть коллекцию
            </Link>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/**
 * Лента ценностей (B1) — text-only, связь с announcement bar. Контент и показ —
 * из настроек Admik (settings.home.valuesStrip). По умолчанию лента СКРЫТА
 * (enabled:false): магазин включает её в админке. Если выключена или нет тезисов —
 * секция не рендерится (ранний null), чтобы не оставлять пустой блок на главной.
 */
export function ValuesStrip({
  values = HOME_FALLBACK.valuesStrip,
}: {
  values?: ResolvedHome["valuesStrip"];
}) {
  const items = values.items;
  if (!values.enabled || items.length === 0) return null;

  return (
    <section className="border-y border-border bg-surface py-12 md:py-16 lg:py-20">
      <div className="container-brand">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 lg:gap-12">
          {items.map((item, i) => (
            <FadeIn key={item.title} delay={i * 0.08}>
              <div className="md:max-w-xs md:mx-auto lg:max-w-none lg:mx-0">
                <p className="heading-md heading-rule mb-5">{item.title}</p>
                <p className="body-editorial max-w-none">{item.text}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

function EditorialCard({
  src,
  hoverSrc,
  alt,
  label,
  href,
  aspect,
  delay,
}: {
  src: string;
  hoverSrc: string;
  alt: string;
  label: string;
  href: string;
  aspect: string;
  delay: number;
}) {
  return (
    <FadeIn delay={delay}>
      <Link href={href} className="group block h-full">
        <LuxuryImageSwap
          primary={src}
          secondary={hoverSrc}
          alt={alt}
          sizes="(max-width: 768px) 100vw, 40vw"
          className={`bg-surface ${aspect}`}
        />
        <div className="mt-7 md:mt-8 flex items-baseline justify-between gap-4">
          <p className="label-caps text-graphite">{label}</p>
          <span className="label-caps text-muted link-underline">Смотреть</span>
        </div>
      </Link>
    </FadeIn>
  );
}

/** Editorial — asymmetric TOTEME-style */
export function EditorialPair({
  categories = [],
}: {
  categories?: AdmikCategoryDto[];
}) {
  return (
    <section className="section-space-sm">
      <div className="container-brand">
        <FadeIn>
          <p className="eyebrow mb-6">Силуэт</p>
          <h2 className="heading-lg heading-rule mb-16 md:mb-20 lg:mb-24">Образы</h2>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 lg:gap-8">
          <div className="md:col-span-7">
            <EditorialCard
              src={IMAGES.editorial.womenPortrait}
              hoverSrc={EDITORIAL_HOVER.women}
              alt="Женское"
              label="Женское"
              href={resolveCategoryHref(categories, "women")}
              aspect="aspect-[3/4]"
              delay={0}
            />
          </div>
          <div className="md:col-span-5">
            <EditorialCard
              src={IMAGES.editorial.menPortrait}
              hoverSrc={EDITORIAL_HOVER.men}
              alt="Мужское"
              label="Мужское"
              href={resolveCategoryHref(categories, "men")}
              aspect="aspect-[3/5] md:aspect-[4/5]"
              delay={0.1}
            />
          </div>
          <div className="md:col-span-12">
            <EditorialCard
              src={IMAGES.editorial.duo}
              hoverSrc={EDITORIAL_HOVER.duo}
              alt="Дуэт"
              label="Дуэт"
              href="/catalog"
              aspect="aspect-[4/3] md:aspect-[21/9]"
              delay={0.18}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function CategoryViews({
  label,
  views,
  href,
}: {
  label: string;
  views: readonly string[];
  href: string;
}) {
  const viewLabels = ["Спереди", "Сбоку", "Сзади"];

  return (
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-3 md:gap-6 lg:gap-8">
      {views.map((src, i) => (
        <FadeIn key={src} delay={i * 0.1}>
          <Link href={href} className="group block">
            <LuxuryImageSwap
              primary={src}
              secondary={categoryViewHover(views, i)}
              alt={`${label} — ${viewLabels[i]}`}
              sizes="33vw"
              className="aspect-[3/4] bg-surface"
            />
            <p className="mt-6 md:mt-7 label-caps text-muted group-hover:text-graphite transition-colors duration-700">
              {viewLabels[i]}
            </p>
          </Link>
        </FadeIn>
      ))}
    </div>
  );
}

/**
 * «Коллекция» (правка 4 + Саша-4/5, B5): единая секция с вкладками «Для женщин»/
 * «Для мужчин». По вкладке показываются РЕАЛЬНЫЕ товары каталога, выбранные на
 * главную (featured = is_featured в админке), разложенные по полу (splitByGender).
 * Если для пола ещё нет featured-товаров — грациозный фолбэк на статичные ракурсы
 * (CategoryViews), чтобы блок не пустовал до наполнения каталога. Ссылка «Смотреть
 * все» резолвится в РЕАЛЬНУЮ категорию каталога (по теме women/men), иначе /catalog.
 */
const COLLECTION_TABS = [
  { key: "women", label: "Для женщин", hint: "women", views: IMAGES.categories.womenViews },
  { key: "men", label: "Для мужчин", hint: "men", views: IMAGES.categories.menViews },
] as const;

/** Сколько товаров показывать в коллекции на главной на одну вкладку. */
const COLLECTION_LIMIT = 4;

export function Collection({
  categories = [],
  featured = [],
}: {
  categories?: AdmikCategoryDto[];
  /** Товары, выбранные на главную (is_featured). Пусто → фолбэк на ракурсы. */
  featured?: StorefrontProduct[];
}) {
  const [active, setActive] = useState<(typeof COLLECTION_TABS)[number]["key"]>("women");
  const current = COLLECTION_TABS.find((t) => t.key === active) ?? COLLECTION_TABS[0];
  const href = resolveCategoryHref(categories, current.hint);

  const gendered = useMemo(() => splitByGender(featured), [featured]);
  const tabProducts = (active === "men" ? gendered.men : gendered.women).slice(0, COLLECTION_LIMIT);

  return (
    // Правка 3 + Саша-3/Аня-3: верхний и нижний отступы сокращены (единый ритм
    // главной; прежние pb-32/44/52 давали избыточный разрыв с блоком ниже).
    <section id="shop" className="pt-10 pb-12 md:pt-14 md:pb-16 lg:pt-16 lg:pb-20">
      <div className="container-brand">
        <FadeIn>
          <h2 className="heading-lg heading-rule mb-10 md:mb-12 max-w-2xl">
            <TextReveal text="Коллекция" />
          </h2>
        </FadeIn>

        <FadeIn delay={0.05}>
          <div className="mb-12 flex flex-col gap-6 md:mb-16 md:flex-row md:items-end md:justify-between">
            <div className="flex gap-8" role="tablist" aria-label="Коллекция">
              {COLLECTION_TABS.map((tab) => {
                const isActive = tab.key === active;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    id={`collection-tab-${tab.key}`}
                    aria-selected={isActive}
                    aria-controls={`collection-panel-${tab.key}`}
                    onClick={() => setActive(tab.key)}
                    className={`relative pb-2 text-sm tracking-wide transition-colors duration-500 ${
                      isActive ? "text-graphite" : "text-muted hover:text-graphite"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`absolute inset-x-0 bottom-0 h-px bg-accent transition-transform duration-500 ${
                        isActive ? "scale-x-100" : "scale-x-0"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
            <Link href={href} className="link-editorial self-start md:self-auto">
              Смотреть все
            </Link>
          </div>
        </FadeIn>

        <div
          role="tabpanel"
          id={`collection-panel-${current.key}`}
          aria-labelledby={`collection-tab-${current.key}`}
        >
          {tabProducts.length > 0 ? (
            // Реальные товары каталога, выбранные на главную (B5).
            <div className="grid grid-cols-2 gap-x-4 gap-y-12 md:gap-x-6 md:gap-y-16 lg:grid-cols-4 lg:gap-x-8">
              {tabProducts.map((product, i) => (
                <ProductCard key={product.slug} product={product} priority={i < 2} />
              ))}
            </div>
          ) : (
            // Фолбэк, пока на главную не выбрано ни одного товара этого пола.
            <CategoryViews label={current.label} views={current.views} href={href} />
          )}
        </div>
      </div>
    </section>
  );
}

/** Shop — category links */
export function ShopCategories({
  categories = [],
}: {
  categories?: AdmikCategoryDto[];
}) {
  return (
    <section className="section-space-sm pb-12 md:pb-16 lg:pb-20">
      <div className="container-brand">
        <FadeIn>
          <p className="eyebrow mb-6 text-center md:text-left">Категории</p>
        </FadeIn>
        <CategoryInfographics categories={categories} />
      </div>
    </section>
  );
}

/**
 * Philosophy — pivot before About. Контент из настроек Admik
 * (settings.home.philosophy) с фолбэком на дефолт витрины.
 *
 * Layout (фикс правки Саша-7/Аня-6/Мадина-10 «пустота справа»): на широком экране
 * — двухколоночная композиция, выровненная по нижней базовой линии: слева
 * надзаголовок + крупный заголовок, справа абзац + ссылка. Колонки делят ширину
 * секции (md:grid-cols-2 + gap), поэтому правое поле больше не зияет пустым; на
 * мобильном — естественный вертикальный стек. Премиум-минимализм сохранён
 * (графит/белый, heading-lg/heading-rule/body-editorial/eyebrow/FadeIn).
 */
export function EditorialStatement({
  philosophy = HOME_FALLBACK.philosophy,
}: {
  philosophy?: ResolvedHome["philosophy"];
}) {
  return (
    <section className="bg-graphite text-white py-12 md:py-16 lg:py-20">
      <div className="container-brand">
        <FadeIn>
          <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:items-end md:gap-12 lg:gap-20">
            <div>
              <p className="eyebrow text-white/45 mb-8">{philosophy.eyebrow}</p>
              <h2 className="heading-lg heading-rule text-white leading-[1.1]">{philosophy.title}</h2>
            </div>
            <div className="md:pb-1">
              <p className="body-editorial text-white/65 mb-10">{philosophy.text}</p>
              <Link
                href={philosophy.linkHref}
                className="text-[10px] uppercase tracking-[0.22em] text-white border-b border-white/40 pb-1 hover:opacity-60 transition-opacity duration-700"
              >
                {philosophy.linkLabel}
              </Link>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

const DETAIL_MOSAIC = [
  "col-span-2 row-span-2",
  "col-span-1 row-span-1",
  "col-span-1 row-span-1",
  "col-span-1 row-span-1",
  "col-span-1 row-span-1",
  "col-span-1 row-span-1",
  "col-span-1 row-span-1",
  "col-span-1 row-span-1",
  "col-span-1 row-span-1",
  "col-span-1 row-span-1",
  "col-span-1 row-span-1",
  "col-span-2 row-span-1",
] as const;

export function DetailsSection() {
  return (
    <section id="materials" className="section-space bg-surface">
      <div className="container-brand">
        <FadeIn>
          <div className="max-w-xl mb-20 md:mb-28 lg:mb-32">
            <p className="eyebrow mb-6">Мастерство</p>
            <h2 className="heading-lg heading-rule mb-8">Детали</h2>
            <p className="body-editorial">Ткани, посадка, функциональные элементы — каждая деталь продумана</p>
          </div>
        </FadeIn>

        <div className="mx-auto max-w-[1400px]">
          <div className="grid grid-cols-2 md:grid-cols-4 auto-rows-[minmax(9.5rem,1fr)] md:auto-rows-[minmax(11.5rem,1fr)] lg:auto-rows-[minmax(13rem,1fr)] gap-3 md:gap-4 lg:gap-5">
            {IMAGES.details.map((src, i) => (
              <FadeIn key={src} delay={i * 0.05} className={`min-h-0 ${DETAIL_MOSAIC[i]}`}>
                <div className="image-luxury relative h-full min-h-[9.5rem] bg-white">
                  <Image src={src} alt={IMAGES.detailLabels[i] ?? `Detail ${i + 1}`} fill className="image-inner object-cover" sizes="(max-width: 768px) 50vw, 25vw" />
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// Слайды для секции «О бренде» (правки клиента). Пока — доступные фото бренда;
// TODO(контент клиента): заменить/дополнить фото эскизов.
const ABOUT_SLIDES = [
  IMAGES.about.duo,
  IMAGES.editorial.womenPortrait,
  IMAGES.editorial.menPortrait,
];

/**
 * Галерея «О бренде». Правка Саша-8/Аня-7: фото компактнее и переехало в правую
 * колонку (см. About) — теперь это ОДИН вертикальный кадр (aspect-3/4) в рамке,
 * с автосменой и точками-переключателями под ним. Узкая правая колонка делает
 * фото визуально меньше текста (≈40% ширины), без распирания вьюпорта.
 */
function AboutGallery({ images }: { images: string[] }) {
  const [i, setI] = useState(0);
  // Находка #22: удалённое фото «О бренде» (S3/CDN) может не загрузиться — на сбой
  // конкретного кадра подменяем его локальным слайдом, чтобы рамка не была пустой.
  const [failed, setFailed] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (images.length < 2) return;
    const t = setInterval(() => setI((p) => (p + 1) % images.length), 5000);
    return () => clearInterval(t);
  }, [images.length]);

  const activeSrc = failed.has(i) ? ABOUT_SLIDES[i % ABOUT_SLIDES.length] : images[i];

  return (
    <div className="relative">
      <div className="image-luxury relative aspect-[3/4] overflow-hidden bg-surface">
        <Image
          src={activeSrc}
          alt="THE CASE — о бренде"
          fill
          onError={() =>
            setFailed((prev) => {
              const next = new Set(prev);
              next.add(i);
              return next;
            })
          }
          className="object-cover object-center transition-opacity duration-700"
          sizes="(max-width: 1024px) 90vw, 40vw"
        />
      </div>
      {images.length > 1 && (
        <div className="mt-4 flex gap-2">
          {images.map((_, n) => (
            <button
              key={n}
              type="button"
              onClick={() => setI(n)}
              aria-label={`Показать фото ${n + 1}`}
              aria-current={i === n}
              className={`h-1.5 rounded-full transition-all duration-500 ${i === n ? "w-8 bg-graphite" : "w-2 bg-border"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * «О бренде» (правки 6, 7 + Саша-8/Аня-7). Двухколоночная композиция: слева текст
 * (надзаголовок «О бренде», заголовок, абзацы и список ценностей, ≈60% ширины),
 * справа — компактное фото в рамке (AboutGallery, ≈40%). На мобильном/планшете
 * (<lg) — естественный вертикальный стек (фото уходит вниз). Нижний отступ секции
 * убран (pt-only), чтобы блок визуально сливался со следующим («Доставка и оплата»).
 */
export function About({ about = HOME_FALLBACK.about }: { about?: ResolvedHome["about"] }) {
  return (
    <section id="about" className="pt-12 md:pt-16 lg:pt-20">
      <div className="container-brand">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-5 lg:items-start lg:gap-16">
          {/* Текст слева (~60%). Заголовок/абзацы/ценности — из настроек Admik
              (G-02, settings.home.about). */}
          <FadeIn className="lg:col-span-3">
            <p className="eyebrow mb-6">О бренде</p>
            <h2 className="heading-lg heading-rule mb-10 md:mb-12">{about.title}</h2>
            <div className="space-y-6 body-editorial [&>p]:max-w-none">
              {about.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <ul className="mt-12 flex flex-wrap gap-x-10 gap-y-4">
              {about.values.map((item) => (
                <li key={item} className="text-[10px] uppercase tracking-[0.2em] text-graphite/80">
                  {item}
                </li>
              ))}
            </ul>
          </FadeIn>

          {/* Фото справа (~40%), меньше и в рамке. Из настроек
              (G-05, settings.home.about.imageUrls), иначе дефолтные ассеты витрины. */}
          <FadeIn delay={0.12} className="lg:col-span-2">
            <div className="mx-auto max-w-sm lg:max-w-none">
              <AboutGallery images={about.imageUrls.length > 0 ? about.imageUrls : ABOUT_SLIDES} />
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

export function Delivery({ delivery = HOME_FALLBACK.delivery }: { delivery?: ResolvedHome["delivery"] }) {
  // Блоки доставки/оплаты — из настроек Admik (G-02, settings.home.delivery).
  const items = delivery.items;

  return (
    // Правка 6 + Саша-3/Аня-3: без верхней границы и с компактным верхним отступом —
    // блок «О бренде» и «Доставка и оплата» читаются как единое целое; ритм сокращён.
    <section id="delivery" className="bg-white pt-12 pb-12 md:pt-16 md:pb-16 lg:pt-20 lg:pb-20">
      <div className="container-brand">
        <FadeIn>
          <div className="max-w-xl mb-16 md:mb-24 lg:mb-28">
            <h2 className="heading-lg heading-rule">Доставка и оплата</h2>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 lg:gap-16">
          {items.map((item, i) => (
            <FadeIn key={item.title} delay={i * 0.1}>
              <article className="border-t border-graphite/15 pt-8 md:pt-10">
                <span className="eyebrow text-silver">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="heading-md mt-6 mb-5">{item.title}</h3>
                <p className="body-editorial">{item.text}</p>
              </article>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
