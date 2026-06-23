import { FadeIn } from "@/components/ui/Animations";
import { CmsSections } from "@/components/cms/CmsSections";
import type { AdmikPageDto } from "@/lib/admik";

/**
 * Обёртка отображения CMS-страницы витрины (G-13): заголовок + секции. Едина для
 * generic-маршрута app/[slug] и юр./инфо-страниц, у которых есть CMS-версия.
 */
export function CmsPageView({ page }: { page: AdmikPageDto }) {
  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="py-8 md:py-12">
        <div className="container-brand">
          <FadeIn>
            <h1 className="heading-lg heading-rule mb-2">{page.title}</h1>
          </FadeIn>
        </div>
        <CmsSections sections={page.sections} />
      </div>
    </div>
  );
}
