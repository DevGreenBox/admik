import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import Providers from "@/components/Providers";
import PageviewBeacon from "@/components/PageviewBeacon";
import { CurrencyProvider } from "@/components/CurrencyProvider";
import { getSiteUrlFromSources, isNoindexFromSources } from "@/lib/site-url";
import { getCategories, listPages, type AdmikCategoryDto } from "@/lib/admik";
import {
  getStoreSettings,
  resolveSeo,
  resolveShopName,
  resolveContacts,
  resolveLogoUrl,
  resolveFaviconUrl,
  resolveTheme,
  resolveCurrency,
} from "@/lib/store-settings";
import { buildInfoLinks } from "@/lib/site-nav";
import "./globals.css";

// Рендер layout — динамический: шапка/футер (shopName, навигация, контакты, логотип
// из getStoreSettings) и подменю «Коллекция» обязаны отражать свежие правки из
// админки Admik на каждый запрос, а не запекаться на сборке (как на страницах).
export const dynamic = "force-dynamic";

// generateMetadata (а не статический объект) — чтобы metadataBase/robots/icons
// читали env И настройки в РАНТАЙМЕ: иначе Next запекает build-time URL (localhost)
// и открытую индексацию в standalone-сборку.
//
// Контент мета (title/description/siteName/favicon) — из настроек Admik (G-16,
// Находка-12/14) с фолбэком на дефолты витрины. Инфраструктура (URL/индексация)
// читает ENV с ПРИОРИТЕТОМ над настройками (staging-защита). Запрос настроек
// мемоизирован (getStoreSettings) и делится с RootLayout (1 HTTP/страницу).
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getStoreSettings();
  const seo = resolveSeo(settings);
  const faviconUrl = resolveFaviconUrl(settings);
  const base = getSiteUrlFromSources(seo.siteUrl);
  const noindex = isNoindexFromSources(seo.noindex);
  return {
    metadataBase: new URL(base),
    title: {
      default: seo.titleDefault,
      template: seo.titleTemplate,
    },
    description: seo.description,
    keywords: ["медицинская форма", "THE CASE", "medical uniform", "premium scrubs", "медицинская одежда"],
    authors: [{ name: seo.siteName }],
    // Фавикон из брендинга (Находка-12); пусто → дефолтный фавикон витрины (public/).
    ...(faviconUrl
      ? { icons: { icon: faviconUrl, shortcut: faviconUrl, apple: faviconUrl } }
      : {}),
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
    robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
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

  // Опубликованные страницы «Контента» для АВТО-навигации (шапка «Информация» +
  // футер). Любая страница, опубликованная в админке, сама становится кликабельной
  // ссылкой — без ручной настройки меню (решает «осиротевшие» страницы). Тот же
  // потолок ожидания (2.5с) и грациозная деградация, что и у категорий.
  let infoLinks: { href: string; label: string }[] = [];
  try {
    const timeout = new Promise<never[]>((resolve) => setTimeout(() => resolve([]), 2500));
    const pages = await Promise.race([listPages(), timeout]);
    infoLinks = buildInfoLinks(pages.map((p) => ({ slug: p.slug, title: p.title })));
  } catch {
    infoLinks = [];
  }

  // Брендинг/контакты/валюта магазина из настроек Admik (G-01) с грациозной
  // деградацией (getStoreSettings: таймаут+фолбэк на дефолты витрины). Мемоизирован
  // с generateMetadata — один запрос настроек на рендер страницы.
  const settings = await getStoreSettings();
  const shopName = resolveShopName(settings);
  const contacts = resolveContacts(settings);
  const logoUrl = resolveLogoUrl(settings);
  const theme = resolveTheme(settings);
  const currency = resolveCurrency(settings);

  // Цвета темы из брендинга (Находка-12) → рантайм-переопределение CSS-переменных
  // Tailwind (--color-accent / --color-graphite). Классы bg-accent/text-graphite
  // ссылаются на эти же переменные, поэтому брендовые цвета применяются каскадно,
  // БЕЗ пересборки. Пустые поля → дефолтные стили витрины (style не задаём).
  const themeStyle: React.CSSProperties = {};
  if (theme.accentColor) (themeStyle as Record<string, string>)["--color-accent"] = theme.accentColor;
  if (theme.primaryColor) (themeStyle as Record<string, string>)["--color-graphite"] = theme.primaryColor;

  return (
    <html lang="ru" style={themeStyle}>
      <body className="min-h-screen flex flex-col">
        <Providers>
          <PageviewBeacon />
          <CurrencyProvider currency={currency}>
            <Header categories={categories} shopName={shopName} logoUrl={logoUrl} infoItems={infoLinks} />
            <main className="flex-1">{children}</main>
            <Footer
              categories={categories}
              shopName={shopName}
              logoUrl={logoUrl}
              contacts={contacts}
              infoLinks={infoLinks}
            />
          </CurrencyProvider>
        </Providers>
      </body>
    </html>
  );
}
