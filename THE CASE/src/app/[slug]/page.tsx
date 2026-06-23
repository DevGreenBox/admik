import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getCmsPage } from "@/lib/cms";
import { CmsPageView } from "@/components/cms/CmsPageView";

// Generic-маршрут CMS-страниц (G-13): любой опубликованный slug из админки
// (например /about, /sizing) рендерится здесь. Статические маршруты витрины
// (/catalog, /contacts, /terms, …) имеют приоритет над [slug] в роутинге Next.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getCmsPage(slug);
  if (!page) return {};
  return {
    title: page.meta.title ?? page.title,
    description: page.meta.description ?? undefined,
  };
}

export default async function CmsSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getCmsPage(slug);
  if (!page) notFound();
  return <CmsPageView page={page} />;
}
