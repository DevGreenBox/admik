/**
 * Контент главной страницы витрины (G-02/G-03/G-05). CLIENT-SAFE: без импорта
 * `react` (cache) — этот модуль импортируется и серверными (page/layout), и
 * КЛИЕНТСКИМИ компонентами (Sections), поэтому здесь только чистые типы/данные/
 * функции. Сетевой слой (getStoreSettings) живёт в server-only @/lib/store-settings.
 *
 * Принцип: значения из настроек Admik (settings.home) ПЕРЕОПРЕДЕЛЯЮТ дефолты;
 * пока владелец не отредактировал блок — берётся HOME_FALLBACK (= текущий вид).
 */

import type { AdmikSettingsDto } from '@/lib/admik';
import { safeHrefOr } from '@/lib/safe-href';

export interface ResolvedHome {
  hero: {
    title: string | null;
    subtitle: string | null;
    /** Публичный URL фонового изображения (резолвлен бэкендом); null → ассет витрины. */
    imageUrl: string | null;
    ctaLabel: string;
    ctaHref: string;
  };
  about: { title: string; paragraphs: string[]; imageUrls: string[]; values: string[] };
  quality: { title: string; items: string[] };
  delivery: { items: { title: string; text: string }[] };
  /** B1 — лента ценностей: показ (enabled) + тезисы. По умолчанию скрыта. */
  valuesStrip: { enabled: boolean; items: { title: string; text: string }[] };
  /** B3 — философия: надзаголовок/заголовок/абзац + ссылка. */
  philosophy: { eyebrow: string; title: string; text: string; linkLabel: string; linkHref: string };
}

/**
 * Единый источник ДЕФОЛТНОГО контента главной (фолбэк, пока владелец не правил
 * блок в админке). Совпадает с тем, что было захардкожено в Sections.tsx и с
 * HOME_DEFAULTS бэкенда — до первой правки внешний вид не меняется.
 */
export const HOME_FALLBACK: ResolvedHome = {
  hero: { title: null, subtitle: null, imageUrl: null, ctaLabel: 'Смотреть коллекцию', ctaHref: '/catalog' },
  about: {
    title: 'О бренде',
    paragraphs: [
      'THE CASE — медицинская униформа нового поколения: функциональная, эстетичная и премиальная. Comfort + Medicine — уверенность, профессионализм, современная эстетика.',
      'Каждая модель разрабатывается вручную — от эскиза до выбора ткани. Комфорт в длинных сменах и ощущение собранности каждый день.',
    ],
    imageUrls: [],
    values: ['Comfort + Medicine', 'Уверенность', 'Профессионализм', 'Минимализм'],
  },
  quality: {
    title: 'Качество ткани',
    items: [
      'Сохраняет глубину и яркость цвета',
      'Устойчива к образованию катышков и зацепок',
      'Эргономичная, повторяет каждое движение',
      'Невесомая и приятная на ощупь',
    ],
  },
  delivery: {
    items: [
      { title: 'СДЭК', text: 'Доставка по всей России. Пункты выдачи и курьер. Автоматический расчёт стоимости.' },
      { title: 'Сроки', text: 'Москва — 1–2 дня. Регионы — 3–5 дня. Отслеживание в личном кабинете.' },
      { title: 'Оплата', text: 'СДЭК PAY, банковские карты, СБП. Безопасная оплата и создание накладной.' },
    ],
  },
  // Лента ценностей по умолчанию СКРЫТА (opt-in): владелец включает её в админке.
  valuesStrip: {
    enabled: false,
    items: [
      { title: 'Форма', text: 'Структурные силуэты и чистые линии медицинской униформы нового поколения.' },
      { title: 'Функция', text: 'Продуманный крой, премиальные ткани и комфорт в длинных сменах.' },
      { title: 'Дисциплина', text: 'Уверенность, профессионализм и современная эстетика каждый день.' },
    ],
  },
  philosophy: {
    eyebrow: 'Философия',
    title: 'Comforts + Medicine = THE CASE',
    text: 'Премиальная медицинская форма для тех, кто ценит эстетику, функциональность и уверенность в профессии.',
    linkLabel: 'О бренде',
    linkHref: '/#about',
  },
};

/** Непустая обрезанная строка либо null. */
function clean(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : null;
}

/** Непустой массив строк либо фолбэк. */
function arr(v: string[] | undefined, fb: string[]): string[] {
  return v && v.length > 0 ? v : fb;
}

/**
 * Контент главной из настроек Admik с фолбэком на дефолты витрины. Бэкенд всегда
 * отдаёт home полностью (mergeHome добивает HOME_DEFAULTS), но при недоступности
 * настроек (s=null) или пустых полях берём HOME_FALLBACK.
 */
export function resolveHome(s: AdmikSettingsDto | null): ResolvedHome {
  const h = s?.home;
  if (!h) return HOME_FALLBACK;
  return {
    hero: {
      title: clean(h.hero?.title),
      subtitle: clean(h.hero?.subtitle),
      imageUrl: clean(h.hero?.imageUrl),
      ctaLabel: clean(h.hero?.ctaLabel) ?? HOME_FALLBACK.hero.ctaLabel,
      // Находка #11: в эту ссылку обёрнут весь первый экран — небезопасное значение
      // из БД подменяем дефолтным маршрутом витрины (см. safeHrefOr).
      ctaHref: safeHrefOr(clean(h.hero?.ctaHref), HOME_FALLBACK.hero.ctaHref),
    },
    about: {
      title: clean(h.about?.title) ?? HOME_FALLBACK.about.title,
      paragraphs: arr(h.about?.paragraphs, HOME_FALLBACK.about.paragraphs),
      imageUrls: h.about?.imageUrls ?? [],
      values: arr(h.about?.values, HOME_FALLBACK.about.values),
    },
    quality: {
      title: clean(h.quality?.title) ?? HOME_FALLBACK.quality.title,
      items: arr(h.quality?.items, HOME_FALLBACK.quality.items),
    },
    delivery: {
      items:
        h.delivery?.items && h.delivery.items.length > 0
          ? h.delivery.items.map((i) => ({ title: i.title, text: i.text }))
          : HOME_FALLBACK.delivery.items,
    },
    valuesStrip: {
      // Показ управляется флагом из настроек (по умолчанию скрыто). Пустой список
      // тезисов при включённой ленте → дефолтные слова витрины (фолбэк по полю).
      enabled: h.valuesStrip?.enabled ?? HOME_FALLBACK.valuesStrip.enabled,
      items:
        h.valuesStrip?.items && h.valuesStrip.items.length > 0
          ? h.valuesStrip.items.map((i) => ({ title: i.title, text: i.text }))
          : HOME_FALLBACK.valuesStrip.items,
    },
    philosophy: {
      eyebrow: clean(h.philosophy?.eyebrow) ?? HOME_FALLBACK.philosophy.eyebrow,
      title: clean(h.philosophy?.title) ?? HOME_FALLBACK.philosophy.title,
      text: clean(h.philosophy?.text) ?? HOME_FALLBACK.philosophy.text,
      linkLabel: clean(h.philosophy?.linkLabel) ?? HOME_FALLBACK.philosophy.linkLabel,
      // Находка #11 — как и hero.ctaHref, значение приходит из настроек Admik.
      linkHref: safeHrefOr(clean(h.philosophy?.linkHref), HOME_FALLBACK.philosophy.linkHref),
    },
  };
}
