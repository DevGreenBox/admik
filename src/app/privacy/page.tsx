import { FadeIn } from "@/components/ui/Animations";

export default function PrivacyPage() {
  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="container-brand py-12 md:py-16 max-w-3xl">
        <FadeIn>
          <h1 className="heading-lg heading-rule mb-8">Политика конфиденциальности</h1>
          <div className="space-y-6 text-sm text-muted leading-relaxed">
            <p>
              Настоящая Политика конфиденциальности определяет порядок обработки и защиты
              персональных данных пользователей интернет-магазина THE CASE.
            </p>
            <p>
              Мы собираем только необходимые данные для обработки заказов: имя, email, телефон
              и адрес доставки. Данные не передаются третьим лицам, за исключением службы
              доставки СДЭК для выполнения заказа.
            </p>
            <p>
              По вопросам обработки данных: hello@thecase.ru
            </p>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
