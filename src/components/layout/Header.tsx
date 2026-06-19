"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ShoppingBag, Heart, User, Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { selectCartCount, selectWishlistCount, useStore } from "@/lib/store";
import { flattenCategoryNav } from "@/lib/catalog-view";
import type { AdmikCategoryDto } from "@/lib/admik";

type NavItem = { href: string; label: string; children?: { href: string; label: string }[] };

const NAV_RIGHT: NavItem[] = [
  { href: "/#delivery", label: "Доставка" },
  { href: "/#contacts", label: "Контакты" },
];

export function Header({ categories = [] }: { categories?: AdmikCategoryDto[] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const cartCount = useStore(selectCartCount);
  const wishlistCount = useStore(selectWishlistCount);

  // Подменю «Коллекция» — из РЕАЛЬНЫХ категорий магазина (не хардкод women/men,
  // которых может не быть → пустой каталог). Если категорий нет — «Коллекция»
  // деградирует до простой ссылки на /catalog.
  const collectionChildren = flattenCategoryNav(categories);
  const NAV_LEFT: NavItem[] = [
    { href: "/catalog", label: "Каталог" },
    collectionChildren.length > 0
      ? { href: "/catalog", label: "Коллекция", children: collectionChildren }
      : { href: "/catalog", label: "Коллекция" },
    { href: "/#about", label: "О бренде" },
  ];

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
                {NAV_LEFT.map((link) =>
                  link.children ? (
                    <div key={link.label} className="relative group/nav">
                      <Link href={link.href} className="eyebrow text-graphite link-underline">
                        {link.label}
                      </Link>
                      <div className="invisible absolute left-0 top-full pt-4 opacity-0 transition-opacity duration-300 group-hover/nav:visible group-hover/nav:opacity-100">
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
                    <Link key={link.label} href={link.href} className="eyebrow text-graphite link-underline">
                      {link.label}
                    </Link>
                  ),
                )}
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
                  key={link.label}
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
