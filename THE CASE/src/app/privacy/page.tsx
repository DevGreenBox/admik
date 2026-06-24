import type { Metadata } from "next";

import { FadeIn } from "@/components/ui/Animations";
import { getCmsPage } from "@/lib/cms";
import { CmsPageView } from "@/components/cms/CmsPageView";

// CMS-overridable с фолбэком (G-13): опубликованная страница 'privacy' из админки
// имеет приоритет; при её отсутствии/ошибке API — статический фолбэк ниже.
export const dynamic = "force-dynamic";

const FALLBACK_METADATA: Metadata = {
  title: "Обработка персональных данных — THE CASE",
  description: "Политика обработки и защиты персональных данных пользователей THE CASE (152-ФЗ).",
};

export async function generateMetadata(): Promise<Metadata> {
  const page = await getCmsPage("privacy");
  if (!page) return FALLBACK_METADATA;
  return {
    title: page.meta.title ?? page.title ?? FALLBACK_METADATA.title,
    description: page.meta.description ?? FALLBACK_METADATA.description,
  };
}

export default async function PrivacyPage() {
  const page = await getCmsPage("privacy");
  if (page) return <CmsPageView page={page} />;

  return <PrivacyFallback />;
}

function PrivacyFallback() {
  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="container-brand py-12 md:py-16 max-w-3xl">
        <FadeIn>
          <h1 className="heading-lg heading-rule mb-8">Обработка персональных данных</h1>
          <div className="space-y-8 text-sm text-muted leading-relaxed">
            <section className="space-y-3">
              <h2 className="text-graphite text-base">1. Общие положения</h2>
              <p>
                Настоящая Политика обработки персональных данных (далее — Политика)
                определяет порядок обработки и защиты персональных данных пользователей
                интернет-магазина THE CASE (далее — Оператор) и действует в отношении
                информации, которую Оператор может получить о пользователе сайта.
                Политика разработана в соответствии с Федеральным законом от 27.07.2006
                № 152-ФЗ «О персональных данных».
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-graphite text-base">2. Состав обрабатываемых данных</h2>
              <p>
                Оператор обрабатывает только те данные, которые необходимы для исполнения
                заказа: фамилия и имя, адрес электронной почты, номер телефона и адрес
                доставки. Дополнительно могут собираться обезличенные данные о посещении
                сайта (cookie, данные веб-аналитики).
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-graphite text-base">3. Цели обработки</h2>
              <p>
                Персональные данные обрабатываются в целях оформления и доставки заказов,
                информирования о статусе заказа, обработки обращений Покупателя, а также
                в иных целях, на которые получено согласие пользователя.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-graphite text-base">4. Правовые основания</h2>
              <p>
                Обработка осуществляется на основании согласия пользователя, выражаемого
                при оформлении заказа и использовании сайта, а также для исполнения
                договора, стороной которого является пользователь.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-graphite text-base">5. Передача третьим лицам</h2>
              <p>
                Данные не передаются третьим лицам, за исключением случаев, необходимых
                для исполнения заказа: службе доставки СДЭК (для доставки) и платёжным
                сервисам (для приёма оплаты), а также в случаях, предусмотренных
                законодательством Российской Федерации.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-graphite text-base">6. Хранение и защита</h2>
              <p>
                Оператор принимает необходимые правовые, организационные и технические
                меры для защиты персональных данных от неправомерного доступа, изменения,
                раскрытия или уничтожения. Данные хранятся не дольше, чем этого требуют
                цели обработки или законодательство.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-graphite text-base">7. Права пользователя</h2>
              <p>
                Пользователь вправе получить информацию об обработке своих персональных
                данных, требовать их уточнения, блокирования или удаления, а также
                отозвать согласие на обработку, направив запрос по адресу hello@thecase.ru.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-graphite text-base">8. Контакты</h2>
              <p>
                По всем вопросам, связанным с обработкой персональных данных, обращайтесь
                по адресу электронной почты hello@thecase.ru.
              </p>
            </section>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
