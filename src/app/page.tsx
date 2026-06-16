import {
  HomeBanner,
  EditorialIntro,
  ValuesStrip,
  EditorialPair,
  CollectionWomen,
  CollectionMen,
  ShopCategories,
  EditorialStatement,
  DetailsSection,
  About,
  Delivery,
} from "@/components/home/Sections";
import { Bestsellers } from "@/components/catalog/ProductCard";
import { listProducts, fromListItem, type StorefrontProduct } from "@/lib/admik";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let bestsellers: StorefrontProduct[] = [];
  try {
    const items = await listProducts({ featured: true, limit: 4 });
    bestsellers = items.map(fromListItem);
  } catch {
    bestsellers = [];
  }

  return (
    <>
      <HomeBanner />
      <EditorialIntro />
      <ValuesStrip />
      <EditorialPair />
      <Bestsellers products={bestsellers} />
      <CollectionWomen />
      <CollectionMen />
      <ShopCategories />
      <DetailsSection />
      <EditorialStatement />
      <About />
      <Delivery />
    </>
  );
}
