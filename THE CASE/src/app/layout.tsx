import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import Providers from "@/components/Providers";
import { getSiteUrl, isNoindex } from "@/lib/site-url";
import { getCategories, type AdmikCategoryDto } from "@/lib/admik";
import { getStoreSettings, resolveSeo, resolveShopName, resolveContacts } from "@/lib/store-settings";
import "./globals.css";

// generateMetadata (а не статический объект) — чтобы metadataBase и robots
// читали env в РАНТАЙМЕ: иначе Next запекает build-time URL (localhost) и
// открытую индексацию в standalone-сборку. STOREFRONT_NOINDEX управляет
// noindex/nofollow для всех страниц витрины (тестовый стенд — закрыт).
//
// Контент мета (title/description/siteName) берётся из настроек Admik (G-16) с
// фолбэком на дефолты витрины; инфраструктура (URL/индексация) — из env. Запрос
// настроек мемоизирован (getStoreSettings) и делится с RootLayout (1 HTTP/страницу).
export async function generateMetadata(): Promise<Metadata> {
  const seo = resolveSeo(await getStoreSettings());
  return {
    metadataBase: new URL(getSiteUrl()),
    title: {
      default: seo.titleDefault,
      template: seo.titleTemplate,
    },
    description: seo.description,
    keywords: ["медицинская форма", "THE CASE", "medical uniform", "premium scrubs", "медицинская одежда"],
    authors: [{ name: seo.siteName }],
    openGraph: {
      title: seo.titleDefault,
      description: seo.ogDescription,
      type: "website",
      locale: "ru_RU",
      siteName: seo.siteName,
      images: [{ url: "/images/home/banner-main.webp", width: 3620, height: 1810, alt: seo.siteName }],
    },
    twitter: {
      card: "summary_large_image",
      title: seo.titleDefault,
      description: seo.ogDescription,
      site: seo.twitterSite ?? undefined,
      images: ["/images/home/banner-main.webp"],
    },
    robots: isNoindex() ? { index: false, follow: false } : { index: true, follow: true },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Категории для навигации «Коллекция» — из реального дерева (не хардкод slug):
  // подменю строится по тому, что реально есть в каталоге магазина (универсально
  // под любой ИМ). Сбой запроса не должен ронять весь layout → деградируем до
  // простой ссылки на /catalog.
  // Категории навигации с ПОТОЛКОМ ожидания: layout рендерится на каждой странице,
  // поэтому ограничиваем ожидание Admik (2.5с) — иначе залипание бэкенда подвесило бы
  // КАЖДУЮ страницу. Сбой/таймаут → пустой список (навигация деградирует до /catalog).
  let categories: AdmikCategoryDto[] = [];
  try {
    const timeout = new Promise<AdmikCategoryDto[]>((resolve) => setTimeout(() => resolve([]), 2500));
    categories = await Promise.race([getCategories(), timeout]);
  } catch {
    categories = [];
  }

  // Брендинг/контакты магазина из настроек Admik (G-01) с грациозной деградацией
  // (getStoreSettings: таймаут+фолбэк на дефолты витрины). Мемоизирован с
  // generateMetadata — один запрос настроек на рендер страницы.
  const settings = await getStoreSettings();
  const shopName = resolveShopName(settings);
  const contacts = resolveContacts(settings);

  return (
    <html lang="ru">
      <body className="min-h-screen flex flex-col">
        <Providers>
          <Header categories={categories} shopName={shopName} />
          <main className="flex-1">{children}</main>
          <Footer categories={categories} shopName={shopName} contacts={contacts} />
        </Providers>
      </body>
    </html>
  );
}
