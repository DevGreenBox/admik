import { Metadata } from "next";
import { CatalogPage } from "@/components/catalog/CatalogPage";
import {
  listProducts,
  getCategories,
  fromListItem,
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

  // Ошибку загрузки ТОВАРОВ НЕ глушим в пустой каталог: иначе при упавшем бэкенде
  // (таймаут/сеть/500) витрина показывала бы ложное «Ничего не найдено / Измените
  // фильтры». Пусть исключение всплывёт в error-границу (error.tsx: «Страница не
  // загрузилась» + «Обновить») — как уже делает product/[slug]. Реально пустой
  // каталог (успешный ответ []) по-прежнему даст корректное «Ничего не найдено».
  // Категории второстепенны (только вкладки фильтра) → их сбой деградируем до [],
  // не роняя весь каталог.
  const [items, cats] = await Promise.all([
    listProducts({ category, q, sale, isNew, limit: 60 }),
    getCategories().catch(() => [] as AdmikCategoryDto[]),
  ]);
  const products = items.map(fromListItem);
  const categories = cats;

  return (
    // key=категория → при смене категории CatalogPage перемонтируется и клиентские
    // фильтры (в т.ч. priceMax) реинициализируются под новый набор товаров. Иначе
    // устаревший priceMax от прошлой (дешёвой) категории прятал бы более дорогие
    // товары новой категории без видимой причины (soft-navigation не размонтирует).
    <CatalogPage
      key={category ?? ""}
      products={products}
      categories={categories}
      activeCategory={category ?? ""}
      sale={sale ?? false}
      isNew={isNew ?? false}
    />
  );
}
