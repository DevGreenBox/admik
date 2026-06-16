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
