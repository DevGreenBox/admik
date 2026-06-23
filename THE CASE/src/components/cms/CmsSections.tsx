import Image from "next/image";
import Link from "next/link";

import {
  listProducts,
  getProduct,
  fromListItem,
  fromDetail,
  type AdmikSectionDto,
  type StorefrontProduct,
} from "@/lib/admik";
import { ProductCard } from "@/components/catalog/ProductCard";

/**
 * Рендерер секций CMS-страницы (G-13). Серверный компонент: секции приходят
 * из Admik как { type, content } (изображения уже резолвлены в URL). HTML в
 * text/hero/cta/faq санитизируется на стороне Admik (доверяем бэкенду). Секция
 * products_grid дотягивает товары через существующий клиент (cms и catalog
 * независимы — инвариант контракта). Тип, который мы не умеем рендерить,
 * пропускается (страница не падает).
 */

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/** Контейнер «насыщенного текста»: стилизует HTML из CMS под типографику витрины. */
const RICH =
  "max-w-3xl text-sm text-muted leading-relaxed [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-base [&_h2]:text-graphite [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-graphite [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-4 [&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-graphite";

async function productsForGrid(c: Record<string, unknown>): Promise<StorefrontProduct[]> {
  const mode = str(c.mode);
  const limit = typeof c.limit === "number" && c.limit > 0 ? Math.min(c.limit, 48) : 12;
  try {
    if (mode === "slugs" && Array.isArray(c.slugs)) {
      const slugs = (c.slugs as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 48);
      const items = await Promise.all(slugs.map((s) => getProduct(s)));
      return items.filter((p): p is NonNullable<typeof p> => p !== null).map(fromDetail);
    }
    if (mode === "category" && str(c.categorySlug)) {
      const rows = await listProducts({ category: str(c.categorySlug)!, limit });
      return rows.map(fromListItem);
    }
    if (mode === "brand" && str(c.brandSlug)) {
      const rows = await listProducts({ limit: 48 });
      return rows.map(fromListItem).filter((p) => p.brand?.slug === str(c.brandSlug)).slice(0, limit);
    }
  } catch {
    /* graceful: подборка пустая, секция просто не покажет товары */
  }
  return [];
}

async function renderSection(s: AdmikSectionDto, i: number) {
  const c = s.content ?? {};
  const key = `${s.type}-${i}`;

  switch (s.type) {
    case "hero": {
      const title = str(c.title);
      const subtitle = str(c.subtitle);
      const html = str(c.html);
      const imageUrl = str(c.imageUrl);
      const ctaLabel = str(c.ctaLabel);
      const ctaHref = str(c.ctaHref);
      return (
        <section key={key} className="container-brand py-10 md:py-14">
          {imageUrl ? (
            <div className="relative mb-8 aspect-[21/9] overflow-hidden bg-surface">
              <Image src={imageUrl} alt={title ?? ""} fill className="object-cover" sizes="100vw" />
            </div>
          ) : null}
          {title ? <h2 className="heading-lg heading-rule mb-4">{title}</h2> : null}
          {subtitle ? <p className="body-editorial mb-4 max-w-2xl">{subtitle}</p> : null}
          {html ? <div className={RICH} dangerouslySetInnerHTML={{ __html: html }} /> : null}
          {ctaLabel && ctaHref ? (
            <Link href={ctaHref} className="link-editorial mt-6 inline-block">
              {ctaLabel}
            </Link>
          ) : null}
        </section>
      );
    }
    case "text": {
      const html = str(c.html);
      if (!html) return null;
      return (
        <section key={key} className="container-brand py-6 md:py-8">
          <div className={RICH} dangerouslySetInnerHTML={{ __html: html }} />
        </section>
      );
    }
    case "banner": {
      const imageUrl = str(c.imageUrl);
      if (!imageUrl) return null;
      const href = str(c.href);
      const alt = str(c.alt) ?? "";
      const img = (
        <div className="relative aspect-[21/9] overflow-hidden bg-surface">
          <Image src={imageUrl} alt={alt} fill className="object-cover" sizes="100vw" />
        </div>
      );
      return (
        <section key={key} className="container-brand py-6 md:py-8">
          {href ? <Link href={href} className="block">{img}</Link> : img}
        </section>
      );
    }
    case "gallery": {
      const images = Array.isArray(c.images)
        ? (c.images as Array<Record<string, unknown>>)
            .map((g) => ({ imageUrl: str(g.imageUrl), alt: str(g.alt) ?? "" }))
            .filter((g) => g.imageUrl)
        : [];
      if (images.length === 0) return null;
      return (
        <section key={key} className="container-brand py-6 md:py-8">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {images.map((g, n) => (
              <div key={n} className="relative aspect-square overflow-hidden bg-surface">
                <Image src={g.imageUrl!} alt={g.alt} fill className="object-cover" sizes="33vw" />
              </div>
            ))}
          </div>
        </section>
      );
    }
    case "faq": {
      const items = Array.isArray(c.items)
        ? (c.items as Array<Record<string, unknown>>)
            .map((it) => ({ q: str(it.q), a: str(it.a) }))
            .filter((it) => it.q && it.a)
        : [];
      if (items.length === 0) return null;
      return (
        <section key={key} className="container-brand py-6 md:py-8">
          <div className="max-w-3xl">
            {items.map((it, n) => (
              <details key={n} className="border-b border-border py-4">
                <summary className="cursor-pointer text-sm text-graphite">{it.q}</summary>
                <div className="mt-3 text-sm text-muted leading-relaxed [&_p]:mb-3 [&_a]:underline" dangerouslySetInnerHTML={{ __html: it.a! }} />
              </details>
            ))}
          </div>
        </section>
      );
    }
    case "cta": {
      const title = str(c.title);
      const html = str(c.html);
      const buttonLabel = str(c.buttonLabel);
      const buttonHref = str(c.buttonHref);
      return (
        <section key={key} className="container-brand py-12 text-center md:py-16">
          {title ? <h2 className="heading-md mb-4">{title}</h2> : null}
          {html ? <div className={`${RICH} mx-auto`} dangerouslySetInnerHTML={{ __html: html }} /> : null}
          {buttonLabel && buttonHref ? (
            <Link href={buttonHref} className="link-editorial mt-6 inline-block">
              {buttonLabel}
            </Link>
          ) : null}
        </section>
      );
    }
    case "products_grid": {
      const title = str(c.title);
      const products = await productsForGrid(c);
      if (products.length === 0) return null;
      return (
        <section key={key} className="container-brand py-10 md:py-14">
          {title ? <h2 className="heading-lg heading-rule mb-8">{title}</h2> : null}
          <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:gap-x-6 lg:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.slug} product={p} />
            ))}
          </div>
        </section>
      );
    }
    default:
      return null;
  }
}

export async function CmsSections({ sections }: { sections: AdmikSectionDto[] }) {
  const rendered = await Promise.all(sections.map((s, i) => renderSection(s, i)));
  return <>{rendered}</>;
}
