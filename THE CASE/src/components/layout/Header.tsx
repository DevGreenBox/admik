"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ShoppingBag, Heart, User, Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { selectCartCount, selectWishlistCount, useStore } from "@/lib/store";
import { flattenCategoryNav } from "@/lib/catalog-view";
import { buildHeaderNav, NAV_DROPDOWN_PANEL_CLASS } from "@/lib/site-nav";
import type { AdmikCategoryDto } from "@/lib/admik";

export function Header({
  categories = [],
  shopName,
  logoUrl,
  headerItems,
  infoItems,
}: {
  categories?: AdmikCategoryDto[];
  /** Имя магазина из настроек Admik (G-01) → логотип. */
  shopName?: string;
  /** URL логотипа-картинки из брендинга (Находка-12); пусто → текстовый логотип. */
  logoUrl?: string | null;
  /** Пункты меню из настроек Admik (G-10); пусто → меню по умолчанию с подменю «Коллекция». */
  headerItems?: { label: string; href: string }[];
  /** Ссылки «Информация» — АВТО из опубликованных страниц Контента (выпадающее меню);
   *  каждая опубликованная страница сама попадает в меню, без ручной настройки. */
  infoItems?: { href: string; label: string }[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const cartCount = useStore(selectCartCount);
  const wishlistCount = useStore(selectWishlistCount);

  // Навигация шапки (Находки S-nav #18/#30): кастомное меню владельца (G-10)
  // СОВМЕЩАЕТСЯ с авто-навигацией платформы, не теряя её — выпадающая «Информация»
  // (опубликованные страницы Контента) и правые «Доставка»/«Контакты» сохраняются
  // даже при кастомном меню (раньше обнулялись). Подменю «Коллекция» строится из
  // РЕАЛЬНЫХ категорий магазина (не хардкод slug); нет категорий → простая ссылка
  // на /catalog. Логика — в чистой buildHeaderNav (покрыта юнит-тестами).
  const { left: NAV_LEFT, right: navRight } = buildHeaderNav({
    headerItems,
    collectionChildren: flattenCategoryNav(categories),
    infoItems,
  });

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-border">
        <div className="container-brand">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-4 md:gap-x-8 h-16 md:h-[72px]">
            <div className="flex min-w-0 items-center gap-6 md:gap-10">
              <button
                className="lg:hidden p-1 -ml-1 text-graphite"
                onClick={() => setMenuOpen(true)}
                aria-label="Меню"
              >
                <Menu className="h-5 w-5" strokeWidth={1} />
              </button>
              {/* Горизонтальное меню — только с lg (≥1024): ниже четыре пункта +
                  центрированный логотип не помещаются в центр-сетку и наезжают друг
                  на друга, поэтому на планшетах/узких ноутах показываем бургер. */}
              <nav className="hidden lg:flex items-center gap-6 lg:gap-8 xl:gap-10">
                {NAV_LEFT.map((link) =>
                  link.children ? (
                    <div key={`${link.href}-${link.label}`} className="relative group/nav flex items-center">
                      <Link href={link.href} aria-haspopup="menu" className="eyebrow leading-none whitespace-nowrap text-graphite link-underline">
                        {link.label}
                      </Link>
                      <div className={NAV_DROPDOWN_PANEL_CLASS}>
                        <div className="flex min-w-[170px] flex-col gap-3 border border-border bg-white px-5 py-4">
                          {link.children.map((child) => (
                            <Link
                              key={child.href}
                              href={child.href}
                              className="eyebrow whitespace-nowrap text-graphite transition-colors duration-300 hover:text-muted"
                            >
                              {child.label}
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Link key={`${link.href}-${link.label}`} href={link.href} className="eyebrow leading-none whitespace-nowrap text-graphite link-underline">
                      {link.label}
                    </Link>
                  ),
                )}
              </nav>
            </div>

            <Logo size="md" shopName={shopName} logoUrl={logoUrl} />

            <div className="flex min-w-0 items-center justify-end gap-5 md:gap-7">
              <nav className="hidden lg:flex items-center gap-6 lg:gap-8 xl:gap-10 mr-2">
                {navRight.map((link) => (
                  <Link key={link.href} href={link.href} className="eyebrow leading-none whitespace-nowrap text-graphite link-underline">
                    {link.label}
                  </Link>
                ))}
              </nav>
              <Link href="/search" className="p-1 text-graphite hover:opacity-50 transition-opacity duration-500" aria-label="Поиск">
                <Search className="h-[16px] w-[16px]" strokeWidth={1} />
              </Link>
              <Link href="/account" className="hidden sm:block p-1 text-graphite hover:opacity-50 transition-opacity duration-500" aria-label="Аккаунт">
                <User className="h-[16px] w-[16px]" strokeWidth={1} />
              </Link>
              <Link href="/wishlist" className="relative p-1 text-graphite hover:opacity-50 transition-opacity duration-500" aria-label="Избранное">
                <Heart className="h-[16px] w-[16px]" strokeWidth={1} />
                {wishlistCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 text-[8px] tabular-nums">{wishlistCount}</span>
                )}
              </Link>
              <Link href="/cart" className="relative p-1 text-graphite hover:opacity-50 transition-opacity duration-500" aria-label="Корзина">
                <ShoppingBag className="h-[16px] w-[16px]" strokeWidth={1} />
                {cartCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 text-[8px] tabular-nums">{cartCount}</span>
                )}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex flex-col bg-white"
          >
            {/* Шапка меню закреплена сверху (shrink-0), список ниже — в отдельной
                скроллящейся области. Раньше меню было fixed inset-0 без прокрутки:
                длинный список (Каталог/О бренде/Информация…) обрезался и на телефоне
                не листался. overscroll-contain + touch-momentum для iOS. */}
            <div className="container-brand flex h-16 shrink-0 items-center justify-between">
              <Logo size="md" shopName={shopName} logoUrl={logoUrl} />
              <button onClick={() => setMenuOpen(false)} aria-label="Закрыть">
                <X className="h-5 w-5" strokeWidth={1} />
              </button>
            </div>
            <motion.nav
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.6 }}
              className="container-brand flex flex-1 flex-col gap-10 overflow-y-auto overscroll-contain pt-12 pb-16 [-webkit-overflow-scrolling:touch]"
            >
              {[...NAV_LEFT, ...navRight].map((link, i) => (
                <motion.div
                  key={`${link.href}-${link.label}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.06 }}
                >
                  <Link href={link.href} onClick={() => setMenuOpen(false)} className="heading-lg text-graphite">
                    {link.label}
                  </Link>
                  {link.children ? (
                    <div className="mt-4 flex flex-col gap-3 pl-1">
                      {link.children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={() => setMenuOpen(false)}
                          className="link-editorial self-start"
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </motion.div>
              ))}
              <div className="mt-8 pt-10 border-t border-border flex flex-col gap-5">
                <Link href="/account" onClick={() => setMenuOpen(false)} className="link-editorial self-start">
                  Личный кабинет
                </Link>
                {/* «Избранное» (#27): раньше достижимо только иконкой-сердечком —
                    в бургер-меню (особенно на телефоне) ссылки не было. */}
                <Link href="/wishlist" onClick={() => setMenuOpen(false)} className="link-editorial self-start">
                  Избранное{wishlistCount > 0 ? ` (${wishlistCount})` : ""}
                </Link>
              </div>
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Total fixed header height for page offset (без announcement-полоски) */
export const HEADER_OFFSET = "pt-16 md:pt-[72px]";
