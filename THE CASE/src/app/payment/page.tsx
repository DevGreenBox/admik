import type { Metadata } from "next";

import { FadeIn } from "@/components/ui/Animations";
import { getCmsPage } from "@/lib/cms";
import { CmsPageView } from "@/components/cms/CmsPageView";

// CMS-overridable с фолбэком (G-13): SEO опубликованной страницы 'payment' из
// админки имеет приоритет; при её отсутствии/ошибке API — статический фолбэк ниже.
export const dynamic = "force-dynamic";

const FALLBACK_METADATA: Metadata = {
  title: "Оплата — THE CASE",
  description: "Способы оплаты заказов в интернет-магазине THE CASE.",
};

export async function generateMetadata(): Promise<Metadata> {
  const page = await getCmsPage("payment");
  if (!page) return FALLBACK_METADATA;
  return {
    title: page.meta.title ?? page.title ?? FALLBACK_METADATA.title,
    description: page.meta.description ?? FALLBACK_METADATA.description,
  };
}

export default async function PaymentPage() {
  const page = await getCmsPage("payment");
  if (page) return <CmsPageView page={page} />;

  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="container-brand py-12 md:py-16 max-w-3xl">
        <FadeIn>
          <h1 className="heading-lg heading-rule mb-8">Оплата</h1>

          <div className="space-y-8 text-sm text-graphite leading-relaxed">
            <p>
              Оплата заказа производится онлайн при оформлении — безопасно, через
              защищённый платёжный шлюз. Данные карты не сохраняются на нашей стороне.
            </p>

            <section className="space-y-5">
              <div className="border-t border-border pt-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">Банковская карта</p>
                <p className="text-muted">Visa, Mastercard, МИР. Оплата онлайн при оформлении заказа.</p>
              </div>
              <div className="border-t border-border pt-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">СБП</p>
                <p className="text-muted">Система быстрых платежей — оплата по QR-коду из приложения банка.</p>
              </div>
              <div className="border-t border-border pt-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">Безопасность</p>
                <p className="text-muted">
                  Все платежи проходят через сертифицированный платёжный сервис.
                  После оплаты формируется заказ и накладная для доставки СДЭК.
                </p>
              </div>
            </section>

            <p className="text-muted">
              Если при оплате возникла ошибка — напишите в поддержку, мы поможем
              завершить заказ.
            </p>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
