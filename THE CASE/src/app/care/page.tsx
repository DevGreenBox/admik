import type { Metadata } from "next";

import { FadeIn } from "@/components/ui/Animations";
import { getCmsPage } from "@/lib/cms";
import { CmsPageView } from "@/components/cms/CmsPageView";

// CMS-overridable с фолбэком (G-13): опубликованная страница 'care' из админки
// имеет приоритет; при её отсутствии/ошибке API — статический фолбэк ниже.
export const dynamic = "force-dynamic";

const FALLBACK_METADATA: Metadata = {
  title: "Уход за вещами — THE CASE",
  description: "Состав ткани и рекомендации по уходу за медицинской формой THE CASE.",
};

export async function generateMetadata(): Promise<Metadata> {
  const page = await getCmsPage("care");
  if (!page) return FALLBACK_METADATA;
  return {
    title: page.meta.title ?? page.title ?? FALLBACK_METADATA.title,
    description: page.meta.description ?? FALLBACK_METADATA.description,
  };
}

export default async function CarePage() {
  const page = await getCmsPage("care");
  if (page) return <CmsPageView page={page} />;

  return <CareFallback />;
}

function CareFallback() {
  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="container-brand py-12 md:py-16 max-w-3xl">
        <FadeIn>
          <h1 className="heading-lg heading-rule mb-8">Уход за вещами</h1>

          <div className="space-y-10 text-sm text-graphite leading-relaxed">
            <section>
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-muted mb-3">Состав</h2>
              <p>72% полиэфир, 21% вискоза, 7% спандекс</p>
            </section>

            <section>
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-muted mb-3">
                Рекомендации по уходу
              </h2>
              <p>
                Вывернуть одежду наизнанку и стирать при температуре воды не выше 30&nbsp;°С
                с вещами аналогичного цвета. Не подвергать химической чистке и не отбеливать.
                Гладить с изнаночной стороны при температуре не выше 110&nbsp;°С.
              </p>
            </section>

            <section className="space-y-2 text-muted">
              <p>· Стирка при 30&nbsp;°С, изнаночная сторона</p>
              <p>· Без химчистки и отбеливания</p>
              <p>· Глажка с изнанки, не выше 110&nbsp;°С</p>
              <p>· Сушить вдали от прямых источников тепла</p>
            </section>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
