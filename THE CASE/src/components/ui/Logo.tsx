"use client";

import Link from "next/link";

interface LogoProps {
  variant?: "dark" | "light";
  size?: "sm" | "md" | "lg";
  showSubtitle?: boolean;
  showAccent?: boolean;
  /** Имя магазина (G-01): из настроек Admik (branding.shopName); фолбэк — THE CASE. */
  shopName?: string;
  /** Подзаголовок логотипа; фолбэк — Medical Uniform. */
  subtitle?: string;
  /** URL логотипа-картинки (Находка-12, branding.logoUrl). Задан → рисуем картинку
   *  вместо текста; пусто → текстовый логотип витрины (прежний вид). */
  logoUrl?: string | null;
}

// Высота логотипа-картинки по размеру (ширина — auto, пропорции сохраняются).
const IMG_HEIGHT: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "h-5",
  md: "h-6 md:h-7",
  lg: "h-9 md:h-11 lg:h-12",
};

export function Logo({
  variant = "dark",
  size = "md",
  showSubtitle = false,
  showAccent = true,
  shopName = "THE CASE",
  subtitle = "Medical Uniform",
  logoUrl,
}: LogoProps) {
  const textColor = variant === "dark" ? "text-graphite" : "text-white";
  const subColor = variant === "dark" ? "text-muted" : "text-white/50";

  const sizes = {
    sm: { title: "text-sm tracking-[-0.02em]", sub: "text-[8px]", line: "w-6" },
    md: { title: "text-sm md:text-base tracking-[-0.02em]", sub: "text-[9px]", line: "w-8" },
    lg: { title: "text-xl md:text-2xl lg:text-3xl tracking-[-0.025em]", sub: "text-[10px]", line: "w-12" },
  };

  const s = sizes[size];
  const hasLogo = typeof logoUrl === "string" && logoUrl.trim().length > 0;

  return (
    <Link
      href="/"
      aria-label={shopName}
      className="group inline-flex flex-col items-center gap-2"
    >
      {hasLogo ? (
        // Логотип-картинка из брендинга (Находка-12). <img> (а не next/image) —
        // домен CDN логотипа произвольный, не обязан быть в remotePatterns; ассет
        // мелкий, оптимизация не критична. На тёмном фоне (variant=light) светлый
        // логотип читается, на белом — тёмный; alt = имя магазина (a11y).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl!.trim()}
          alt={shopName}
          className={`${IMG_HEIGHT[size]} w-auto object-contain transition-opacity duration-700 group-hover:opacity-60`}
          loading="eager"
          decoding="async"
        />
      ) : (
        <span
          className={`${s.title} ${textColor} font-display font-normal uppercase transition-opacity duration-700 group-hover:opacity-60`}
        >
          {shopName}
        </span>
      )}
      {showAccent && !hasLogo && <span className={`${s.line} h-[2px] bg-accent block`} />}
      {showSubtitle && (
        <span className={`${s.sub} ${subColor} uppercase tracking-[0.04em]`}>
          {subtitle}
        </span>
      )}
    </Link>
  );
}
