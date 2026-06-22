"use client";

import Link from "next/link";

interface LogoProps {
  variant?: "dark" | "light";
  size?: "sm" | "md" | "lg";
  showSubtitle?: boolean;
  showAccent?: boolean;
}

export function Logo({ variant = "dark", size = "md", showSubtitle = false, showAccent = true }: LogoProps) {
  const textColor = variant === "dark" ? "text-graphite" : "text-white";
  const subColor = variant === "dark" ? "text-muted" : "text-white/50";

  const sizes = {
    sm: { title: "text-sm tracking-[-0.02em]", sub: "text-[8px]", line: "w-6" },
    md: { title: "text-sm md:text-base tracking-[-0.02em]", sub: "text-[9px]", line: "w-8" },
    lg: { title: "text-xl md:text-2xl lg:text-3xl tracking-[-0.025em]", sub: "text-[10px]", line: "w-12" },
  };

  const s = sizes[size];

  return (
    <Link href="/" className="group inline-flex flex-col items-center gap-2">
      <span
        className={`${s.title} ${textColor} font-display font-normal uppercase transition-opacity duration-700 group-hover:opacity-60`}
      >
        THE CASE
      </span>
      {showAccent && <span className={`${s.line} h-[2px] bg-accent block`} />}
      {showSubtitle && (
        <span className={`${s.sub} ${subColor} uppercase tracking-[0.04em]`}>
          Medical Uniform
        </span>
      )}
    </Link>
  );
}
