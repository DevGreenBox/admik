import { Metadata } from "next";
import { CatalogPage } from "@/components/catalog/CatalogPage";
import {
  listProducts,
  getCategories,
  fromListItem,
  type StorefrontProduct,
  type AdmikCategoryDto,
} from "@/lib/admik";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Коллекция",
  description: "Каталог премиальной медицинской формы THE CASE",
};

export default async function Catalog({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    q?: string;
    sale?: string;
    new?: string;
  }>;
}) {
  const sp = await searchParams;
  const category = sp.category || undefined;
  const q = sp.q || undefined;
  const sale = sp.sale === "1" || sp.sale === "true" ? true : undefined;
  const isNew = sp.new === "1" || sp.new === "true" ? true : undefined;

  let products: StorefrontProduct[] = [];
  let categories: AdmikCategoryDto[] = [];
  try {
    const [items, cats] = await Promise.all([
      listProducts({ category, q, sale, isNew, limit: 60 }),
      getCategories(),
    ]);
    products = items.map(fromListItem);
    categories = cats;
  } catch {
    products = [];
    categories = [];
  }

  return (
    <CatalogPage
      products={products}
      categories={categories}
      activeCategory={category ?? ""}
    />
  );
}
