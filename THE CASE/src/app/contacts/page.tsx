import { Send, Phone, Mail } from "lucide-react";
import { FadeIn } from "@/components/ui/Animations";
import { getStoreSettings, resolveContacts } from "@/lib/store-settings";
import { ContactsForm } from "./ContactsForm";

// Серверный компонент: контакты тянутся из настроек Admik (G-01/G-07) с
// фолбэком на плейсхолдеры витрины. Реальные телефон/Telegram/email владелец
// задаёт в админке (Настройки → Контакты), без правки кода витрины.
export default async function ContactsPage() {
  const c = resolveContacts(await getStoreSettings());

  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="container-brand py-12 md:py-16 max-w-4xl">
        <FadeIn>
          <p className="eyebrow mb-6">Свяжитесь с нами</p>
          <h1 className="heading-lg heading-rule mb-6">Контакты</h1>
          <p className="body-editorial max-w-2xl mb-12 md:mb-16">
            Ответим на вопросы о коллекции, подборе размера, доставке и заказе.
            Напишите нам в форме ниже или выберите удобный способ связи.
          </p>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-16">
          <FadeIn>
            <h2 className="heading-md mb-6">Форма обратной связи</h2>
            <ContactsForm />
          </FadeIn>

          <FadeIn delay={0.1}>
            <h2 className="heading-md mb-6">Прямые контакты</h2>
            <ul className="space-y-6">
              {c.telegramUrl && (
                <li>
                  <a
                    href={c.telegramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-4"
                  >
                    <Send className="h-5 w-5 text-graphite mt-0.5" strokeWidth={1} />
                    <span>
                      <span className="block eyebrow text-muted mb-1">Telegram</span>
                      <span className="text-sm text-graphite link-underline">
                        {c.telegramHandle ?? c.telegramUrl}
                      </span>
                    </span>
                  </a>
                </li>
              )}
              <li>
                <a href={`tel:${c.phoneTel}`} className="group flex items-start gap-4">
                  <Phone className="h-5 w-5 text-graphite mt-0.5" strokeWidth={1} />
                  <span>
                    <span className="block eyebrow text-muted mb-1">Телефон</span>
                    <span className="text-sm text-graphite link-underline">{c.phoneDisplay}</span>
                  </span>
                </a>
              </li>
              <li>
                <a href={`mailto:${c.email}`} className="group flex items-start gap-4">
                  <Mail className="h-5 w-5 text-graphite mt-0.5" strokeWidth={1} />
                  <span>
                    <span className="block eyebrow text-muted mb-1">Email</span>
                    <span className="text-sm text-graphite link-underline">{c.email}</span>
                  </span>
                </a>
              </li>
            </ul>
          </FadeIn>
        </div>
      </div>
    </div>
  );
}
