import Image from "next/image";

interface LuxuryImageSwapProps {
  primary: string;
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
  const hasSwap = Boolean(secondary && secondary !== primary);

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
