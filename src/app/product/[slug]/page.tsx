import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getProduct,
  listProducts,
  fromDetail,
  fromListItem,
  type StorefrontProduct,
} from "@/lib/admik";
import { ProductDetailClient } from "@/components/product/ProductDetailClient";

export const dynamic = "force-dynamic";

// Per-product SEO: берём готовый meta-блок из Storefront API (Admik уже применил
// фолбэки — title=имя товара и т.п.). Без этого каждая карточка наследовала бы
// общий title лейаута («одинаковый SEO на всех товарах»).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const dto = await getProduct(slug).catch(() => null);
  if (!dto) return { title: "Товар не найден" };
  const m = dto.meta;
  const canonical = m.canonical ?? undefined;
  return {
    title: m.title,
    description: m.description ?? undefined,
    ...(canonical ? { alternates: { canonical } } : {}),
    robots: m.noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      title: m.ogTitle,
      description: m.ogDescription ?? undefined,
      ...(m.ogImageUrl ? { images: [{ url: m.ogImageUrl }] } : {}),
      ...(canonical ? { url: canonical } : {}),
      type: "website",
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const dto = await getProduct(slug);
  if (!dto) notFound();

  const product = fromDetail(dto);

  let related: StorefrontProduct[] = [];
  try {
    const items = await listProducts({ limit: 8 });
    related = items
      .map(fromListItem)
      .filter((p) => p.slug !== product.slug)
      .slice(0, 4);
  } catch {
    related = [];
  }

  return <ProductDetailClient product={product} related={related} />;
}
