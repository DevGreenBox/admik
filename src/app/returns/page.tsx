import { FadeIn } from "@/components/ui/Animations";

export const metadata = {
  title: "Обмен и возврат — THE CASE",
  description: "Условия обмена и возврата товара в интернет-магазине THE CASE.",
};

export default function ReturnsPage() {
  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="container-brand py-12 md:py-16 max-w-3xl">
        <FadeIn>
          <h1 className="heading-lg heading-rule mb-8">Обмен и возврат</h1>

          <div className="space-y-8 text-sm text-graphite leading-relaxed">
            <p>
              Вы можете вернуть или обменять товар в течение 14&nbsp;дней с момента
              получения, если он не подошёл по размеру, цвету или фасону.
            </p>

            <section className="space-y-5">
              <div className="border-t border-border pt-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">Условия</p>
                <ul className="space-y-2 text-muted">
                  <li>· Товар не был в использовании и сохранил товарный вид</li>
                  <li>· Сохранены фабричные бирки и упаковка</li>
                  <li>· Есть документ, подтверждающий покупку</li>
                </ul>
              </div>
              <div className="border-t border-border pt-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">Как оформить</p>
                <p className="text-muted">
                  Напишите в поддержку — подскажем ближайший пункт СДЭК и оформим заявку.
                  Возврат отправляется через СДЭК.
                </p>
              </div>
              <div className="border-t border-border pt-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">Возврат средств</p>
                <p className="text-muted">
                  Деньги возвращаются тем же способом, которым была произведена оплата,
                  в течение 10&nbsp;рабочих дней после получения и проверки возврата.
                </p>
              </div>
            </section>

            <p className="text-muted">
              Товары надлежащего качества из категории «бельё» обмену и возврату не подлежат
              согласно законодательству РФ.
            </p>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
