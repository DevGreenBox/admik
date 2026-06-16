"use client";

import { useState } from "react";
import Link from "next/link";
import { FadeIn } from "@/components/ui/Animations";
import { Logo } from "@/components/ui/Logo";
import { IMAGES } from "@/lib/images";

const FOOTER_LINKS = {
  shop: [
    { href: "/catalog", label: "Коллекция" },
    { href: "/catalog?category=women", label: "Женская форма" },
    { href: "/catalog?category=men", label: "Мужская форма" },
    { href: "/catalog?category=suits", label: "Костюмы" },
    { href: "/catalog?category=coats", label: "Халаты" },
  ],
  service: [
    { href: "/#delivery", label: "Доставка и оплата" },
    { href: "/#contacts", label: "Контакты" },
    { href: "/account", label: "Личный кабинет" },
  ],
  legal: [
    { href: "/privacy", label: "Политика конфиденциальности" },
    { href: "/terms", label: "Пользовательское соглашение" },
  ],
};

export function Footer() {
  const [email, setEmail] = useState("");

  return (
    <footer id="contacts" className="relative bg-graphite text-white mt-32 md:mt-40 lg:mt-48 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center pointer-events-none saturate-0 blur-[2px]"
        style={{ backgroundImage: `url(${IMAGES.footer.bg})` }}
      />
      <div className="absolute inset-0 bg-black/25 pointer-events-none" />
      <div className="container-brand py-20 md:py-28 relative z-10">
        <FadeIn>
          {/* Jil Sander / ETRU — 4-column footer grid + newsletter */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-14 md:gap-8 lg:gap-6">
            <div className="md:col-span-3">
              <Logo variant="light" size="md" showSubtitle />
            </div>

            <div className="md:col-span-2">
              <h4 className="eyebrow text-white/40 mb-6">Shop</h4>
              <ul className="space-y-3">
                {FOOTER_LINKS.shop.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-[11px] tracking-[0.1em] text-white/55 hover:text-white transition-colors duration-500">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="md:col-span-2">
              <h4 className="eyebrow text-white/40 mb-6">Service</h4>
              <ul className="space-y-3">
                {FOOTER_LINKS.service.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-[11px] tracking-[0.1em] text-white/55 hover:text-white transition-colors duration-500">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-8 space-y-3 text-[11px] text-white/55">
                <a href="mailto:hello@thecase.ru" className="block hover:text-white transition-colors">hello@thecase.ru</a>
                <a href="tel:+74951234567" className="block hover:text-white transition-colors">+7 (495) 123-45-67</a>
              </div>
            </div>

            <div className="md:col-span-2">
              <h4 className="eyebrow text-white/40 mb-6">Legal</h4>
              <ul className="space-y-3">
                {FOOTER_LINKS.legal.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-[11px] tracking-[0.1em] text-white/55 hover:text-white transition-colors duration-500">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex gap-6">
                {["Instagram", "Telegram"].map((s) => (
                  <a key={s} href="#" className="eyebrow text-white/35 hover:text-white transition-colors">{s}</a>
                ))}
              </div>
            </div>

            <div className="md:col-span-3">
              <h4 className="eyebrow text-white/40 mb-6">Newsletter</h4>
              <p className="text-[11px] text-white/55 leading-relaxed mb-6">
                Новости коллекций и эксклюзивные материалы бренда.
              </p>
              <form
                onSubmit={(e) => { e.preventDefault(); setEmail(""); }}
                className="flex border-b border-white/25 pb-2"
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="flex-1 bg-transparent text-[11px] text-white placeholder:text-white/35 outline-none tracking-wide"
                />
                <button type="submit" className="text-[10px] uppercase tracking-[0.2em] text-white/70 hover:text-white transition-colors ml-4">
                  Подписаться
                </button>
              </form>
            </div>
          </div>
        </FadeIn>

        {/* Jil Sander — oversized wordmark */}
        <div className="mt-20 md:mt-28 pt-10 border-t border-white/10">
          <p className="footer-wordmark text-center select-none">THE CASE</p>
          <div className="flex justify-center mt-5">
            <span className="h-[2px] w-14 bg-accent" />
          </div>
          <p className="text-center eyebrow text-white/30 mt-6">
            © {new Date().getFullYear()} · Medical Uniform
          </p>
        </div>
      </div>
    </footer>
  );
}
