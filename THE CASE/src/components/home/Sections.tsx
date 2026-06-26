"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { FadeIn, TextReveal } from "@/components/ui/Animations";
import { HEADER_OFFSET } from "@/components/layout/Header";
import { CategoryInfographics } from "@/components/home/CategoryInfographic";
import { IMAGES, EDITORIAL_HOVER, categoryViewHover } from "@/lib/images";
import { LuxuryImageSwap } from "@/components/ui/LuxuryImageSwap";
import { resolveCategoryHref } from "@/lib/catalog-view";
import type { AdmikCategoryDto } from "@/lib/admik";
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
    // Правка 3: уменьшен нижний отступ — промежуток до блока «Коллекция» был
    // слишком большим (стек section-space-sm + section-space).
    <section className="pt-24 pb-12 md:pt-36 md:pb-16 lg:pt-44 lg:pb-20">
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

        {/* «Качество ткани» — статичный блок ниже (правка 2: вместо отдельного слайда) */}
        <FadeIn delay={0.1}>
          <div
            className="relative mt-6 flex min-h-[360px] items-center overflow-hidden md:min-h-[420px]"
            style={{ background: "linear-gradient(135deg,#9a9da1,#7e8186 40%,#6f7277)" }}
          >
            {/* TODO(контент клиента): заменить серый градиент на фото фактуры ткани.
                Светлые диагональные линии (а не чёрные) дают видимую фактуру ткани
                поверх тёмного градиента вместо «грязного серого»; opacity поднята до
                0.2 — текстура читается, но остаётся фоном под текстом. */}
            <div
              className="absolute inset-0 opacity-20 mix-blend-soft-light"
              style={{ backgroundImage: "repeating-linear-gradient(45deg,#fff 0 1px,transparent 1px 5px)" }}
            />
            <div className="relative w-full px-8 py-14 text-white md:px-14 md:py-20">
              <p className="eyebrow mb-6 text-white/60">{quality.title}</p>
              <ul className="max-w-xl space-y-4">
                {quality.items.map((f) => (
                  <li key={f} className="body-editorial border-l border-white/40 pl-5 text-white/90">
                    {f}
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
    <section className="section-space-sm pb-20 md:pb-32 lg:pb-40">
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

/** Форма / Функция / Дисциплина — text-only, связь с announcement bar */
export function ValuesStrip() {
  const items = [
    {
      title: "Форма",
      text: "Структурные силуэты и чистые линии медицинской униформы нового поколения.",
    },
    {
      title: "Функция",
      text: "Продуманный крой, премиальные ткани и комфорт в длинных сменах.",
    },
    {
      title: "Дисциплина",
      text: "Уверенность, профессионализм и современная эстетика каждый день.",
    },
  ];

  return (
    <section className="border-y border-border bg-surface py-16 md:py-20 lg:py-24">
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
          <p className="eyebrow mb-6">Silhouette</p>
          <h2 className="heading-lg heading-rule mb-16 md:mb-20 lg:mb-24">Editorial</h2>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 lg:gap-8">
          <div className="md:col-span-7">
            <EditorialCard
              src={IMAGES.editorial.womenPortrait}
              hoverSrc={EDITORIAL_HOVER.women}
              alt="Women"
              label="Women"
              href={resolveCategoryHref(categories, "women")}
              aspect="aspect-[3/4]"
              delay={0}
            />
          </div>
          <div className="md:col-span-5">
            <EditorialCard
              src={IMAGES.editorial.menPortrait}
              hoverSrc={EDITORIAL_HOVER.men}
              alt="Men"
              label="Men"
              href={resolveCategoryHref(categories, "men")}
              aspect="aspect-[3/5] md:aspect-[4/5]"
              delay={0.1}
            />
          </div>
          <div className="md:col-span-12">
            <EditorialCard
              src={IMAGES.editorial.duo}
              hoverSrc={EDITORIAL_HOVER.duo}
              alt="Duo"
              label="Duo"
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
  const viewLabels = ["Front", "Side", "Back"];

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
 * «Коллекция» (правка 4): единая секция с вкладками «Для женщин»/«Для мужчин».
 * Раньше были две отдельные секции (CollectionWomen + CollectionMen) с
 * надзаголовком «Shop» и заголовками «Women»/«Men». Теперь надзаголовок «Shop»
 * убран, а клик по вкладке переключает соответствующий блок товаров (без двух
 * секций). Ссылка «Смотреть все» и блок фото резолвятся в РЕАЛЬНУЮ категорию
 * каталога (по теме women/men), иначе /catalog.
 */
const COLLECTION_TABS = [
  { key: "women", label: "Для женщин", hint: "women", views: IMAGES.categories.womenViews },
  { key: "men", label: "Для мужчин", hint: "men", views: IMAGES.categories.menViews },
] as const;

export function Collection({
  categories = [],
}: {
  categories?: AdmikCategoryDto[];
}) {
  const [active, setActive] = useState<(typeof COLLECTION_TABS)[number]["key"]>("women");
  const current = COLLECTION_TABS.find((t) => t.key === active) ?? COLLECTION_TABS[0];
  const href = resolveCategoryHref(categories, current.hint);

  return (
    // Правка 3: верхний отступ сокращён (до этого section-space сверху давал
    // избыточный разрыв с блоком «Создано вместе с врачами»).
    <section id="shop" className="pt-16 pb-32 md:pt-20 md:pb-44 lg:pt-24 lg:pb-52">
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
          <CategoryViews label={current.label} views={current.views} href={href} />
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
    <section className="section-space-sm pb-28 md:pb-36 lg:pb-44">
      <div className="container-brand">
        <FadeIn>
          <p className="eyebrow mb-6 text-center md:text-left">Категории</p>
        </FadeIn>
        <CategoryInfographics categories={categories} />
      </div>
    </section>
  );
}

/** Philosophy — pivot before About */
export function EditorialStatement() {
  return (
    <section className="bg-graphite text-white py-16 md:py-20 lg:py-24">
      <div className="container-brand">
        <FadeIn>
          <div className="max-w-2xl">
            <p className="eyebrow text-white/45 mb-8">Philosophy</p>
            <h2 className="heading-lg heading-rule text-white mb-10 leading-[1.1]">Comforts + Medicine = THE CASE</h2>
            <p className="body-editorial text-white/65 max-w-lg mb-12">
              Премиальная медицинская форма для тех, кто ценит эстетику,
              функциональность и уверенность в профессии.
            </p>
            <Link href="/#about" className="text-[10px] uppercase tracking-[0.22em] text-white border-b border-white/40 pb-1 hover:opacity-60 transition-opacity duration-700">
              О бренде
            </Link>
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
            <p className="eyebrow mb-6">Craft</p>
            <h2 className="heading-lg heading-rule mb-8">Details</h2>
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
 * Галерея «О бренде». Правка 7: фото уменьшены — раньше одно крупное вертикальное
 * (aspect-3/4) выходило за вьюпорт; теперь горизонтальный ряд из трёх компактных
 * кадров (aspect-3/4 в три колонки), целиком помещается на экран. Автосмена
 * акцентного кадра сохранена, точки-переключатели оставлены под рядом.
 */
function AboutGallery({ images }: { images: string[] }) {
  const [i, setI] = useState(0);
  // Находка #22: удалённое фото «О бренде» (S3/CDN) может не загрузиться — на сбой
  // конкретного кадра подменяем его локальным слайдом, чтобы плитка не была пустой.
  const [failed, setFailed] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (images.length < 2) return;
    const t = setInterval(() => setI((p) => (p + 1) % images.length), 5000);
    return () => clearInterval(t);
  }, [images.length]);

  return (
    <div className="relative">
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        {images.map((src, n) => (
          <button
            key={src}
            type="button"
            onClick={() => setI(n)}
            aria-label={`Фото ${n + 1}`}
            aria-current={i === n}
            className="image-luxury relative aspect-[3/4] overflow-hidden bg-surface"
          >
            <Image
              src={failed.has(n) ? ABOUT_SLIDES[n % ABOUT_SLIDES.length] : src}
              alt="THE CASE — о бренде"
              fill
              onError={() =>
                setFailed((prev) => {
                  const next = new Set(prev);
                  next.add(n);
                  return next;
                })
              }
              className={`object-cover object-center transition-all duration-700 ${
                i === n ? "opacity-100" : "opacity-60"
              }`}
              sizes="(max-width: 1024px) 33vw, 20vw"
            />
          </button>
        ))}
      </div>
      {images.length > 1 && (
        <div className="mt-4 flex gap-2">
          {images.map((_, n) => (
            <button
              key={n}
              onClick={() => setI(n)}
              aria-label={`Показать фото ${n + 1}`}
              className={`h-1.5 rounded-full transition-all duration-500 ${i === n ? "w-8 bg-graphite" : "w-2 bg-border"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * «О бренде» (правки 6, 7). Текст растянут на всю ширину сверху — раньше он жил
 * в узкой правой колонке, из-за чего слева оставалась пустота. Фото уменьшены
 * (AboutGallery). Нижний отступ секции убран (pt-only), чтобы блок визуально
 * сливался со следующим («Доставка и оплата») без разрыва.
 */
export function About({ about = HOME_FALLBACK.about }: { about?: ResolvedHome["about"] }) {
  return (
    <section id="about" className="pt-32 md:pt-44 lg:pt-52">
      <div className="container-brand">
        <FadeIn>
          <p className="eyebrow mb-6">About</p>
          {/* Заголовок/абзацы/ценности — из настроек Admik (G-02, settings.home.about). */}
          <h2 className="heading-lg heading-rule mb-10 md:mb-12">{about.title}</h2>
          <div className="grid grid-cols-1 gap-8 body-editorial lg:grid-cols-2 [&>p]:max-w-none">
            {about.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </FadeIn>

        <FadeIn delay={0.12}>
          <div className="mt-12 md:mt-16">
            {/* Фото галереи — из настроек (G-05, settings.home.about.imageUrls),
                иначе дефолтные ассеты витрины. */}
            <AboutGallery images={about.imageUrls.length > 0 ? about.imageUrls : ABOUT_SLIDES} />
          </div>
        </FadeIn>

        <FadeIn delay={0.18}>
          <ul className="mt-12 flex flex-wrap gap-x-10 gap-y-4 md:mt-16">
            {about.values.map((item) => (
              <li key={item} className="text-[10px] uppercase tracking-[0.2em] text-graphite/80">
                {item}
              </li>
            ))}
          </ul>
        </FadeIn>
      </div>
    </section>
  );
}

export function Delivery({ delivery = HOME_FALLBACK.delivery }: { delivery?: ResolvedHome["delivery"] }) {
  // Блоки доставки/оплаты — из настроек Admik (G-02, settings.home.delivery).
  const items = delivery.items;

  return (
    // Правка 6: без верхней границы и с компактным верхним отступом — блок «О бренде»
    // и «Доставка и оплата» читаются как единое целое, без разрыва.
    <section id="delivery" className="bg-white pt-20 pb-24 md:pt-28 md:pb-36 lg:pt-32 lg:pb-44">
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
