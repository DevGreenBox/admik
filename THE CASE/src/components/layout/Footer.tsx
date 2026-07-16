"use client";

import { useState } from "react";
import Link from "next/link";
import { FadeIn } from "@/components/ui/Animations";
import { Logo } from "@/components/ui/Logo";
import { IMAGES } from "@/lib/images";
import { categoryLinks } from "@/lib/catalog-view";
import { subscribeNewsletter } from "@/lib/admik";
import type { AdmikCategoryDto } from "@/lib/admik";
import type { ResolvedContacts } from "@/lib/store-settings";
import { resolveFooterColumns, resolveSocialLinks, type FooterColumn } from "@/lib/site-nav";
import { submitNewsletter } from "@/lib/newsletter-form";

const FOOTER_LINKS = {
  legal: [
    { href: "/privacy", label: "Обработка персональных данных" },
    { href: "/terms", label: "Пользовательское соглашение" },
  ],
};

// Колонки футера по умолчанию (если настройки навигации пусты).
// Правка Саша/Аня: колонка «Service» убрана целиком (её сервисные ссылки
// доступны из шапки и блока «Поддержка»); оставлена только правовая информация.
const DEFAULT_COLUMNS = [
  { title: "Правовая информация", links: FOOTER_LINKS.legal },
];

const CONTACTS_FALLBACK: ResolvedContacts = {
  phoneDisplay: "+7 (___) ___-__-__",
  phoneTel: "+70000000000",
  email: "hello@thecase.ru",
  telegramHandle: "@thecase",
  telegramUrl: "https://t.me/thecase",
  address: null,
  socials: [],
};

export function Footer({
  categories = [],
  shopName = "THE CASE",
  logoUrl,
  contacts,
  infoLinks,
  columns,
}: {
  categories?: AdmikCategoryDto[];
  /** Имя магазина из настроек Admik (G-01). */
  shopName?: string;
  /** URL логотипа-картинки из брендинга (Находка-12); пусто → текстовый логотип. */
  logoUrl?: string | null;
  /** Контакты/соцсети из настроек Admik (G-01/G-08). */
  contacts?: ResolvedContacts;
  /** Ссылки «Информация» — АВТО из опубликованных страниц Контента (любая страница
   *  становится кликабельной без ручной настройки); пусто → DEFAULT_COLUMNS. */
  infoLinks?: { href: string; label: string }[];
  /** Колонки футера из настроек Admik (G-11, Находка #18); пусто → DEFAULT_COLUMNS. */
  columns?: FooterColumn[];
}) {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [subPending, setSubPending] = useState(false);
  // Ошибка подписки (#10): раньше catch был пуст → покупатель думал, что подписался.
  const [subError, setSubError] = useState<string | null>(null);
  const c = contacts ?? CONTACTS_FALLBACK;

  // Подписка на рассылку (G-12): шлёт email на Storefront API; идемпотентна.
  // Логика — в чистой submitNewsletter (покрыта юнит-тестами): при сбое возвращает
  // сообщение, а не молчит, чтобы покупатель мог повторить (#10).
  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || subPending) return;
    setSubPending(true);
    setSubError(null);
    const res = await submitNewsletter(email, subscribeNewsletter);
    if (res.ok) {
      setSubscribed(true);
      setEmail("");
    } else if (res.error) {
      setSubError(res.error);
    }
    setSubPending(false);
  };
  // Колонки футера: из настроек Admik (G-11), иначе дефолтные (Правовая информация). Сверху
  // — авто-колонка «Информация» с опубликованными страницами, которых ещё нет в
  // выбранных колонках (без дублей), чтобы любая страница была достижима кликом
  // (нет «осиротевших»). Логика — в чистой resolveFooterColumns (с юнит-тестами).
  const cols: FooterColumn[] = resolveFooterColumns({
    settingsColumns: columns,
    defaultColumns: DEFAULT_COLUMNS,
    infoLinks,
  });
  const lastCol = cols.length - 1;

  // Ссылки «Shop» строятся из РЕАЛЬНЫХ категорий магазина. «Коллекция» — всегда.
  // «Распродажа»/«Новинки» (F18) — точки входа в серверные фасеты каталога
  // (?sale=1 / ?new=1), иначе эти фильтры недостижимы из UI.
  const shopLinks = [
    { href: "/catalog", label: "Коллекция" },
    { href: "/catalog?sale=1", label: "Распродажа" },
    { href: "/catalog?new=1", label: "Новинки" },
    ...categoryLinks(categories, 4).map((cat) => ({ href: cat.href, label: cat.name })),
  ];

  // Соцсети: из настроек (G-08), иначе только рабочий Telegram (никаких мёртвых
  // якорей вроде Instagram "#") — логика в чистой resolveSocialLinks (C10/C21).
  const socialLinks = resolveSocialLinks(c);

  return (
    <footer id="contacts" className="relative bg-graphite text-white mt-16 md:mt-24 lg:mt-28 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center pointer-events-none saturate-0 blur-[2px]"
        style={{ backgroundImage: `url(${IMAGES.footer.bg})` }}
      />
      <div className="absolute inset-0 bg-black/25 pointer-events-none" />
      <div className="container-brand py-14 md:py-20 relative z-10">
        <FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-14 md:gap-8 lg:gap-6">
            <div className="md:col-span-3">
              <Logo variant="light" size="md" showSubtitle shopName={shopName} logoUrl={logoUrl} />
            </div>

            <div className="md:col-span-2">
              {/* Правка Саша/Аня: надзаголовок «Shop» → «Магазин» (ссылки каталога). */}
              <h4 className="eyebrow text-white/40 mb-6">Магазин</h4>
              <ul className="space-y-3">
                {shopLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-[11px] tracking-[0.1em] text-white/55 hover:text-white transition-colors duration-500">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* «Поддержка» — отдельная колонка (раньше была пришита к колонке
                «Service», которую убрали): контакты магазина из настроек (G-01/G-08). */}
            <div className="md:col-span-2">
              <h4 className="eyebrow text-white/40 mb-6">Поддержка</h4>
              <div className="space-y-3 text-[11px] text-white/55">
                {c.telegramUrl ? (
                  <a href={c.telegramUrl} target="_blank" rel="noopener noreferrer" className="block hover:text-white transition-colors">
                    Написать в Telegram
                  </a>
                ) : null}
                <a href={`tel:${c.phoneTel}`} className="block hover:text-white transition-colors">Позвонить</a>
                <a href={`mailto:${c.email}`} className="block hover:text-white transition-colors">{c.email}</a>
              </div>
            </div>

            {/* Колонки из настроек (G-11) или дефолтные (Правовая информация +
                авто-«Информация»). Под последней — соцсети (как в исходном футере). */}
            {cols.map((col, ci) => (
              <div key={ci} className="md:col-span-2">
                <h4 className="eyebrow text-white/40 mb-6">{col.title}</h4>
                <ul className="space-y-3">
                  {col.links.map((link) => (
                    <li key={`${link.href}-${link.label}`}>
                      <Link href={link.href} className="text-[11px] tracking-[0.1em] text-white/55 hover:text-white transition-colors duration-500">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>

                {ci === lastCol ? (
                  <div className="mt-8 flex gap-6">
                    {socialLinks.map((s) => (
                      <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="eyebrow text-white/35 hover:text-white transition-colors">
                        {s.label}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            <div className="md:col-span-3">
              <h4 className="eyebrow text-white/40 mb-6">Рассылка</h4>
              <p className="text-[11px] text-white/55 leading-relaxed mb-6">
                Новости коллекций и эксклюзивные материалы бренда.
              </p>
              {subscribed ? (
                <p className="text-[11px] text-white/70">Спасибо! Вы подписаны на рассылку.</p>
              ) : (
                <>
                  <form onSubmit={handleSubscribe} className="flex border-b border-white/25 pb-2">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email"
                      className="flex-1 bg-transparent text-[11px] text-white placeholder:text-white/35 outline-none tracking-wide"
                    />
                    <button type="submit" disabled={subPending} className="text-[10px] uppercase tracking-[0.2em] text-white/70 hover:text-white transition-colors ml-4 disabled:opacity-50">
                      {subPending ? "…" : "Подписаться"}
                    </button>
                  </form>
                  {/* Ошибка подписки (#10): видимый сигнал, чтобы покупатель повторил,
                      а не считал, что подписался. role=alert — для скринридеров. */}
                  {subError ? (
                    <p role="alert" className="mt-3 text-[11px] text-red-300">{subError}</p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </FadeIn>

        <div className="mt-20 md:mt-28 pt-10 border-t border-white/10">
          <p className="footer-wordmark text-center select-none">{shopName}</p>
          <div className="flex justify-center mt-5">
            <span className="h-[2px] w-14 bg-accent" />
          </div>
          <p className="text-center eyebrow text-white/30 mt-6">
            © {new Date().getFullYear()} · {shopName}
          </p>
        </div>
      </div>
    </footer>
  );
}
