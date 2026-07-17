import {
  HomeBanner,
  CoverSlides,
  ValuesStrip,
  Collection,
  ShopCategories,
  EditorialStatement,
  About,
  Delivery,
} from "@/components/home/Sections";
import {
  getCategories,
  listProducts,
  fromListItem,
  type AdmikCategoryDto,
  type StorefrontProduct,
} from "@/lib/admik";
import { getStoreSettings, resolveHome } from "@/lib/store-settings";

export const dynamic = "force-dynamic";

// Композиция главной (правки клиента): обложка → «Создано вместе с врачами»
// (+ качество ткани) → коллекция (вкладки женщины/мужчины) → лента
// «форма/функция/дисциплина» → категории → философия → о бренде → доставка.
// Убраны: «Medical Fashion», «Editorial», «Bestsellers» (пока нет товаров),
// «Материалы» (нечем заполнить). Women/Men объединены в Collection (вкладки).
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

  // Товары, выбранные на главную (is_featured), — реальная «Коллекция» по табам
  // жен/муж (B5, Саша-4/5). Тот же потолок ожидания (2.5с), что у категорий;
  // сбой/таймаут → [] (Collection грациозно покажет статичные ракурсы).
  let featured: StorefrontProduct[] = [];
  try {
    const items = await Promise.race([
      listProducts({ featured: true, limit: 12 }),
      new Promise<Awaited<ReturnType<typeof listProducts>>>((resolve) =>
        setTimeout(() => resolve([]), 2500),
      ),
    ]);
    featured = items.map(fromListItem);
  } catch {
    featured = [];
  }

  // Контент главной из настроек Admik (G-02/G-03) с грациозным фолбэком на
  // дефолты витрины (getStoreSettings: таймаут+null → HOME_FALLBACK).
  const home = resolveHome(await getStoreSettings());

  return (
    <>
      <HomeBanner hero={home.hero} />
      <CoverSlides quality={home.quality} />
      <Collection categories={categories} featured={featured} />
      <ValuesStrip values={home.valuesStrip} />
      <ShopCategories categories={categories} />
      <EditorialStatement philosophy={home.philosophy} />
      <About about={home.about} />
      <Delivery delivery={home.delivery} />
    </>
  );
}
