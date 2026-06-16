import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import Providers from "@/components/Providers";
import { getSiteUrl } from "@/lib/site-url";
import "./globals.css";

const SITE_URL = getSiteUrl();
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
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
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen flex flex-col">
        <Providers>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
