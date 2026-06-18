import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import Providers from "@/components/Providers";
import { getSiteUrl, isNoindex } from "@/lib/site-url";
import { getCategories, type AdmikCategoryDto } from "@/lib/admik";
import "./globals.css";

// generateMetadata (а не статический объект) — чтобы metadataBase и robots
// читали env в РАНТАЙМЕ: иначе Next запекает build-time URL (localhost) и
// открытую индексацию в standalone-сборку. STOREFRONT_NOINDEX управляет
// noindex/nofollow для всех страниц витрины (тестовый стенд — закрыт).
export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(getSiteUrl()),
    title: {
      default: "THE CASE — Premium Medical Uniform",
      template: "%s | THE CASE",
    },
    description:
      "Премиальная медицинская форма нового поколения. Fashion + Medicine. Минимализм, уверенность, чистые силуэты.",
    keywords: ["медицинская форма", "THE CASE", "medical uniform", "premium scrubs", "медицинская одежда"],
    authors: [{ name: "THE CASE" }],
    openGraph: {
      title: "THE CASE — Premium Medical Uniform",
      description: "Fashion meets medicine. Премиальная медицинская униформа.",
      type: "website",
      locale: "ru_RU",
      siteName: "THE CASE",
      images: [{ url: "/images/home/banner-main.webp", width: 3620, height: 1810, alt: "THE CASE" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "THE CASE — Premium Medical Uniform",
      description: "Fashion meets medicine.",
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
  let categories: AdmikCategoryDto[] = [];
  try {
    categories = await getCategories();
  } catch {
    categories = [];
  }

  return (
    <html lang="ru">
      <body className="min-h-screen flex flex-col">
        <Providers>
          <Header categories={categories} />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
