import Image from "next/image";

interface LuxuryImageSwapProps {
  /** URL основного фото; может отсутствовать (товар без медиа) → плейсхолдер. */
  primary?: string | null;
  secondary?: string | null;
  alt: string;
  priority?: boolean;
  sizes?: string;
  className?: string;
  imageClassName?: string;
}

export function LuxuryImageSwap({
  primary,
  secondary,
  alt,
  priority = false,
  sizes = "50vw",
  className = "",
  imageClassName = "object-cover object-center",
}: LuxuryImageSwapProps) {
  const hasSwap = Boolean(primary && secondary && secondary !== primary);

  // Нет фото (весь стенд может быть без медиа) → не передаём undefined в next/image
  // (это роняет рендер), а показываем аккуратный плейсхолдер поверх bg-surface.
  if (!primary) {
    return (
      <div className={`group/swap image-luxury relative overflow-hidden ${className}`} role="img" aria-label={alt}>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[9px] uppercase tracking-[0.22em] text-muted">Нет фото</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`group/swap image-luxury relative overflow-hidden ${className}`}>
      <Image
        src={primary}
        alt={alt}
        fill
        priority={priority}
        loading={priority ? "eager" : "lazy"}
        sizes={sizes}
        className={`${imageClassName} ${hasSwap ? "group-hover/swap:invisible" : ""}`}
      />
      {hasSwap && (
        <Image
          src={secondary!}
          alt=""
          aria-hidden
          fill
          loading="eager"
          sizes={sizes}
          className={`absolute inset-0 invisible group-hover/swap:visible ${imageClassName}`}
        />
      )}
    </div>
  );
}
