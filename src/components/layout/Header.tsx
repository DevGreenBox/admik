"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ShoppingBag, Heart, User, Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { selectCartCount, useStore } from "@/lib/store";

const NAV_LEFT = [
  { href: "/#shop", label: "Коллекция" },
  { href: "/#about", label: "О бренде" },
  { href: "/#materials", label: "Материалы" },
];

const NAV_RIGHT = [
  { href: "/#delivery", label: "Доставка" },
  { href: "/#contacts", label: "Контакты" },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const cartCount = useStore(selectCartCount);
  const wishlistCount = useStore((s) => s.wishlist.length);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-border">
        {/* Announcement bar — Jil Sander / brandbook */}
        <div className="hidden md:flex items-center justify-center border-b border-border/60 bg-surface py-2.5">
          <p className="text-[9px] uppercase tracking-[0.36em] text-muted">
            Форма / Функция / Дисциплина — премиальная медицинская униформа
          </p>
        </div>

        <div className="container-brand">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center h-16 md:h-[72px]">
            <div className="flex items-center gap-6 md:gap-10">
              <button
                className="md:hidden p-1 -ml-1 text-graphite"
                onClick={() => setMenuOpen(true)}
                aria-label="Меню"
              >
                <Menu className="h-5 w-5" strokeWidth={1} />
              </button>
              <nav className="hidden md:flex items-center gap-8 lg:gap-10">
                {NAV_LEFT.map((link) => (
                  <Link key={link.href} href={link.href} className="eyebrow text-graphite link-underline">
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>

            <Logo size="md" />

            <div className="flex items-center justify-end gap-5 md:gap-7">
              <nav className="hidden md:flex items-center gap-8 lg:gap-10 mr-2">
                {NAV_RIGHT.map((link) => (
                  <Link key={link.href} href={link.href} className="eyebrow text-graphite link-underline">
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
            className="fixed inset-0 z-[60] bg-white"
          >
            <div className="container-brand flex h-16 items-center justify-between">
              <Logo size="md" />
              <button onClick={() => setMenuOpen(false)} aria-label="Закрыть">
                <X className="h-5 w-5" strokeWidth={1} />
              </button>
            </div>
            <motion.nav
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.6 }}
              className="container-brand flex flex-col gap-10 pt-20"
            >
              {[...NAV_LEFT, ...NAV_RIGHT].map((link, i) => (
                <motion.div
                  key={link.href}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.06 }}
                >
                  <Link href={link.href} onClick={() => setMenuOpen(false)} className="heading-lg text-graphite">
                    {link.label}
                  </Link>
                </motion.div>
              ))}
              <div className="mt-8 pt-10 border-t border-border flex flex-col gap-5">
                <Link href="/catalog" onClick={() => setMenuOpen(false)} className="link-editorial self-start">
                  Каталог
                </Link>
                <Link href="/account" onClick={() => setMenuOpen(false)} className="link-editorial self-start">
                  Личный кабинет
                </Link>
              </div>
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Total fixed header height for page offset */
export const HEADER_OFFSET = "pt-[104px] md:pt-[116px]";
