"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface ProductGalleryProps {
  images: string[];
  name: string;
}

export function ProductGallery({ images, name }: ProductGalleryProps) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  // Смена цвета подменяет НАБОР снимков (см. imagesForColor). Без сброса индекс
  // указывал бы в старый список: при переходе с цвета с 3 фото на цвет с 1 фото
  // images[active] = undefined → <Image src={undefined}> роняет рендер карточки.
  // Ключ сброса — сам список: смена цвета меняет ссылку на массив.
  useEffect(() => {
    setActive(0);
  }, [images]);

  const next = useCallback(() => setActive((i) => (i + 1) % images.length), [images.length]);
  const prev = useCallback(() => setActive((i) => (i - 1 + images.length) % images.length), [images.length]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, next, prev]);

  // Нет фото (товар без медиа — весь стенд может быть без картинок): плейсхолдер
  // вместо <Image src={undefined}> (консистентно с карточкой каталога).
  if (!images || images.length === 0) {
    return (
      <div
        className="image-luxury relative flex-1 aspect-[3/4] max-h-[68vh] bg-surface flex items-center justify-center"
        role="img"
        aria-label={name}
      >
        <span className="text-[10px] uppercase tracking-[0.22em] text-muted">Нет фото</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col-reverse lg:flex-row gap-4 lg:gap-6">
        {images.length > 1 && (
          <div className="flex lg:flex-col gap-2 lg:gap-3 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0 scrollbar-hide lg:w-20 shrink-0">
            {images.map((img, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                className={`relative w-14 h-[72px] lg:w-full lg:h-24 shrink-0 overflow-hidden ${
                  active === i ? "opacity-100" : "opacity-40 hover:opacity-70"
                }`}
              >
                <Image src={img} alt="" fill className="object-contain object-center" sizes="80px" loading="lazy" />
              </button>
            ))}
          </div>
        )}

        <div
          className="image-luxury group relative flex-1 aspect-[3/4] max-h-[68vh] bg-surface cursor-zoom-in"
          onClick={() => setLightbox(true)}
        >
          <Image
            key={active}
            src={images[active]}
            alt={`${name} — фото ${active + 1}`}
            fill
            priority
            quality={90}
            className="object-contain"
            sizes="(max-width: 1024px) 100vw, 45vw"
          />

          {images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); prev(); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-700 text-graphite"
                aria-label="Назад"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={1} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); next(); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-700 text-graphite"
                aria-label="Вперёд"
              >
                <ChevronRight className="h-5 w-5" strokeWidth={1} />
              </button>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="fixed inset-0 z-[80] bg-white flex items-center justify-center"
            onClick={() => setLightbox(false)}
          >
            <button
              className="absolute top-8 right-8 text-graphite p-2 hover:opacity-50 transition-opacity"
              onClick={() => setLightbox(false)}
            >
              <X className="h-6 w-6" strokeWidth={1} />
            </button>
            <motion.div
              className="relative w-full max-w-3xl aspect-[3/4] mx-6"
              onClick={(e) => e.stopPropagation()}
            >
              <Image key={active} src={images[active]} alt={name} fill quality={90} className="object-contain" sizes="100vw" />
            </motion.div>
            {images.length > 1 && (
              <>
                <button onClick={(e) => { e.stopPropagation(); prev(); }} className="absolute left-6 top-1/2 -translate-y-1/2 text-graphite p-3">
                  <ChevronLeft className="h-6 w-6" strokeWidth={1} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); next(); }} className="absolute right-6 top-1/2 -translate-y-1/2 text-graphite p-3">
                  <ChevronRight className="h-6 w-6" strokeWidth={1} />
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
