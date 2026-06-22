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
import { getCategories, type AdmikCategoryDto } from "@/lib/admik";

export const dynamic = "force-dynamic";

// Композиция главной (правки клиента): обложка → women → лента
// «форма/функция/дисциплина» (с описанием) → men → категории → философия →
// о бренде → доставка. Убраны: «Medical Fashion», «Editorial», «Bestsellers»
// (пока нет товаров), «Материалы» (нечем заполнить).
export default async function HomePage() {
  // РЕАЛЬНЫЕ категории каталога (не зашитые slug): ссылки блоков women/men/
  // категории резолвятся в существующие категории магазина, иначе вели бы в
  // ПУСТОЙ каталог. Потолок ожидания (2.5с) как в layout — залипание бэкенда не
  // должно подвешивать главную; сбой/таймаут → [] (ссылки деградируют к /catalog).
  let categories: AdmikCategoryDto[] = [];
  try {
    const timeout = new Promise<AdmikCategoryDto[]>((resolve) =>
      setTimeout(() => resolve([]), 2500),
    );
    categories = await Promise.race([getCategories(), timeout]);
  } catch {
    categories = [];
  }

  return (
    <>
      <HomeBanner />
      <CoverSlides />
      <CollectionWomen categories={categories} />
      <ValuesStrip />
      <CollectionMen categories={categories} />
      <ShopCategories categories={categories} />
      <EditorialStatement />
      <About />
      <Delivery />
    </>
  );
}
