import { FadeIn } from "@/components/ui/Animations";

export default function TermsPage() {
  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="container-brand py-12 md:py-16 max-w-3xl">
        <FadeIn>
          <h1 className="heading-lg heading-rule mb-8">Пользовательское соглашение</h1>
          <div className="space-y-6 text-sm text-muted leading-relaxed">
            <p>
              Используя сайт THE CASE, вы соглашаетесь с условиями настоящего соглашения.
            </p>
            <p>
              Возврат товара возможен в течение 14 дней с момента получения при сохранении
              товарного вида, бирок и упаковки. Для оформления возврата свяжитесь с нами
              по email: hello@thecase.ru
            </p>
            <p>
              Оплата производится через СДЭК PAY, банковские карты или СБП. Доставка
              осуществляется службой СДЭК по всей территории России.
            </p>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
