"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { FadeIn, TextReveal } from "@/components/ui/Animations";
import { HEADER_OFFSET } from "@/components/layout/Header";
import { CategoryInfographics } from "@/components/home/CategoryInfographic";
import { IMAGES, EDITORIAL_HOVER, categoryViewHover } from "@/lib/images";
import { LuxuryImageSwap } from "@/components/ui/LuxuryImageSwap";
import { resolveCategoryHref } from "@/lib/catalog-view";
import type { AdmikCategoryDto } from "@/lib/admik";

/** Full-width banner — первый блок под меню (+ CTA «смотреть коллекцию») */
export function HomeBanner() {
  return (
    <section className={HEADER_OFFSET}>
      <div className="relative block w-full">
        <Image
          src={IMAGES.home.banner}
          alt="THE CASE — Medical Uniform"
          width={3620}
          height={1810}
          priority
          className="block w-full h-auto object-contain"
          sizes="100vw"
        />
        {/* CTA на обложке (правка клиента) */}
        <div className="absolute inset-x-0 bottom-[6%] flex justify-center md:bottom-[8%]">
          <Link
            href="/catalog"
            className="bg-white/90 px-8 py-3 text-[10px] uppercase tracking-[0.22em] text-graphite backdrop-blur-sm transition-colors duration-500 hover:bg-white md:px-10 md:py-4 md:text-[11px]"
          >
            Смотреть коллекцию
          </Link>
        </div>
      </div>
    </section>
  );
}

const FABRIC_FEATURES = [
  "Сохраняет глубину и яркость цвета",
  "Устойчива к образованию катышков и зацепок",
  "Эргономичная, повторяет каждое движение",
  "Невесомая и приятная на ощупь",
];

/**
 * Слайды на обложке (правки клиента): «О бренде» (форма создаётся на основе
 * предпочтений реальных докторов; место под эскизы) + «Качество ткани» (фактура +
 * характеристики). Точки + автопрокрутка. Серая фактура и эскизы — плейсхолдеры
 * до получения фото от клиента (см. TODO).
 */
export function CoverSlides() {
  const slides = ["about", "fabric"] as const;
  const [i, setI] = useState(0);
  const go = useCallback(
    (n: number) => setI(((n % slides.length) + slides.length) % slides.length),
    [slides.length],
  );

  useEffect(() => {
    const t = setInterval(() => setI((p) => (p + 1) % slides.length), 7000);
    return () => clearInterval(t);
  }, [slides.length]);

  return (
    <section className="section-space-sm">
      <div className="container-brand">
        <div className="relative overflow-hidden">
          <AnimatePresence mode="wait">
            {slides[i] === "about" ? (
              <motion.div
                key="about"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6 }}
                className="grid grid-cols-1 items-center gap-10 bg-surface p-8 md:p-14 lg:grid-cols-2 lg:gap-16"
              >
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
              </motion.div>
            ) : (
              <motion.div
                key="fabric"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6 }}
                className="relative flex min-h-[420px] items-center md:min-h-[520px]"
                style={{ background: "linear-gradient(135deg,#9a9da1,#7e8186 40%,#6f7277)" }}
              >
                {/* TODO(контент клиента): заменить серый градиент на фото фактуры ткани */}
                <div
                  className="absolute inset-0 opacity-[0.12]"
                  style={{ backgroundImage: "repeating-linear-gradient(45deg,#000 0 1px,transparent 1px 4px)" }}
                />
                <div className="relative container-brand py-14 text-white md:py-20">
                  <p className="eyebrow mb-6 text-white/60">Качество ткани</p>
                  <ul className="max-w-xl space-y-4">
                    {FABRIC_FEATURES.map((f) => (
                      <li key={f} className="body-editorial border-l border-white/40 pl-5 text-white/90">
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-6 flex justify-center gap-2">
          {slides.map((s, n) => (
            <button
              key={s}
              onClick={() => go(n)}
              aria-label={`Слайд ${n + 1}`}
              className={`h-1.5 rounded-full transition-all duration-500 ${i === n ? "w-8 bg-graphite" : "w-2 bg-border"}`}
            />
          ))}
        </div>
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
  hint,
  views,
  categories,
}: {
  label: string;
  hint: string;
  views: readonly string[];
  categories: AdmikCategoryDto[];
}) {
  const viewLabels = ["Front", "Side", "Back"];
  // Ссылка резолвится в РЕАЛЬНУЮ категорию (по теме hint), иначе /catalog.
  const href = resolveCategoryHref(categories, hint);

  return (
    <>
      <FadeIn>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12 md:mb-16">
          <h3 className="heading-lg heading-rule">{label}</h3>
          <Link href={href} className="link-editorial self-start md:self-auto">
            Смотреть все
          </Link>
        </div>
      </FadeIn>

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
    </>
  );
}

/** Shop — Women */
export function CollectionWomen({
  categories = [],
}: {
  categories?: AdmikCategoryDto[];
}) {
  return (
    <section id="shop" className="section-space">
      <div className="container-brand">
        <FadeIn>
          <p className="eyebrow mb-6">Shop</p>
          <h2 className="heading-lg heading-rule mb-16 md:mb-20 lg:mb-28 max-w-2xl">
            <TextReveal text="Коллекция" />
          </h2>
        </FadeIn>
        <CategoryViews label="Women" hint="women" views={IMAGES.categories.womenViews} categories={categories} />
      </div>
    </section>
  );
}

/** Shop — Men */
export function CollectionMen({
  categories = [],
}: {
  categories?: AdmikCategoryDto[];
}) {
  return (
    <section className="section-space-sm border-t border-border">
      <div className="container-brand">
        <CategoryViews label="Men" hint="men" views={IMAGES.categories.menViews} categories={categories} />
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
          <p className="eyebrow mb-6 text-center md:text-left">Categories</p>
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

function AboutGallery({ images }: { images: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (images.length < 2) return;
    const t = setInterval(() => setI((p) => (p + 1) % images.length), 5000);
    return () => clearInterval(t);
  }, [images.length]);

  return (
    <div className="relative">
      <div className="image-luxury relative aspect-[3/4] overflow-hidden bg-surface">
        <AnimatePresence mode="wait">
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0"
          >
            <Image src={images[i]} alt="THE CASE — о бренде" fill className="object-cover object-center" sizes="40vw" />
          </motion.div>
        </AnimatePresence>
      </div>
      {images.length > 1 && (
        <div className="mt-4 flex gap-2">
          {images.map((_, n) => (
            <button
              key={n}
              onClick={() => setI(n)}
              aria-label={`Фото ${n + 1}`}
              className={`h-1.5 rounded-full transition-all duration-500 ${i === n ? "w-8 bg-graphite" : "w-2 bg-border"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function About() {
  return (
    <section id="about" className="section-space">
      <div className="container-brand">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-16 lg:gap-20 items-start">
          <FadeIn direction="left" className="lg:col-span-3">
            <AboutGallery images={ABOUT_SLIDES} />
          </FadeIn>

          <FadeIn direction="right" delay={0.15} className="lg:col-span-2 lg:pt-12 xl:pt-16">
            <p className="eyebrow mb-6">About</p>
            <h2 className="heading-lg heading-rule mb-10 md:mb-12">О бренде</h2>
            <div className="space-y-8 body-editorial">
              <p>
                THE CASE — медицинская униформа нового поколения: функциональная, эстетичная и премиальная.
                Fashion + Medicine — уверенность, профессионализм, современная эстетика.
              </p>
              <p>
                Каждая модель разрабатывается вручную — от эскиза до выбора ткани. Комфорт
                в длинных сменах и ощущение собранности каждый день.
              </p>
            </div>
            <ul className="mt-14 md:mt-16 space-y-5">
              {["Fashion + Medicine", "Уверенность", "Профессионализм", "Минимализм"].map((item) => (
                <li key={item} className="text-[10px] uppercase tracking-[0.2em] text-graphite/80">
                  {item}
                </li>
              ))}
            </ul>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

export function Delivery() {
  const items = [
    { title: "СДЭК", desc: "Доставка по всей России. Пункты выдачи и курьер. Автоматический расчёт стоимости." },
    { title: "Сроки", desc: "Москва — 1–2 дня. Регионы — 3–5 дня. Отслеживание в личном кабинете." },
    { title: "Оплата", desc: "СДЭК PAY, банковские карты, СБП. Безопасная оплата и создание накладной." },
  ];

  return (
    <section id="delivery" className="section-space-sm border-t border-border bg-white">
      <div className="container-brand pt-4 md:pt-8">
        <FadeIn>
          <div className="max-w-xl mb-16 md:mb-24 lg:mb-28">
            <p className="eyebrow mb-6">Service</p>
            <h2 className="heading-lg heading-rule">Доставка и оплата</h2>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 lg:gap-16">
          {items.map((item, i) => (
            <FadeIn key={item.title} delay={i * 0.1}>
              <article className="border-t border-graphite/15 pt-8 md:pt-10">
                <span className="eyebrow text-silver">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="heading-md mt-6 mb-5">{item.title}</h3>
                <p className="body-editorial">{item.desc}</p>
              </article>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
