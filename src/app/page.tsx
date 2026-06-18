import {
  HomeBanner,
  CoverSlides,
  ValuesStrip,
  CollectionWomen,
  CollectionMen,
  ShopCategories,
  EditorialStatement,
  About,
  Delivery,
} from "@/components/home/Sections";

export const dynamic = "force-dynamic";

// Композиция главной (правки клиента): обложка → women → лента
// «форма/функция/дисциплина» (с описанием) → men → категории → философия →
// о бренде → доставка. Убраны: «Medical Fashion», «Editorial», «Bestsellers»
// (пока нет товаров), «Материалы» (нечем заполнить).
export default async function HomePage() {
  return (
    <>
      <HomeBanner />
      <CoverSlides />
      <CollectionWomen />
      <ValuesStrip />
      <CollectionMen />
      <ShopCategories />
      <EditorialStatement />
      <About />
      <Delivery />
    </>
  );
}
