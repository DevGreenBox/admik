"use client";

import { useState } from "react";
import { Send, Phone, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FadeIn } from "@/components/ui/Animations";

// TODO: заменить на реальные контакты заказчицы
const CONTACT_PHONE_DISPLAY = "+7 (___) ___-__-__";
const CONTACT_PHONE_TEL = "tel:+70000000000";
const CONTACT_TELEGRAM_HANDLE = "@thecase";
const CONTACT_TELEGRAM_URL = "https://t.me/thecase";
const CONTACT_EMAIL = "hello@thecase.ru";

function ContactsForm() {
  const [form, setForm] = useState({ name: "", contact: "", message: "" });
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: подключить реальный API отправки заявок. Пока — клиентская
    // заглушка с состоянием «отправлено» (паттерн форм витрины, ср. Footer
    // newsletter). При желании можно заменить на mailto на CONTACT_EMAIL.
    setSent(true);
    setForm({ name: "", contact: "", message: "" });
  };

  if (sent) {
    return (
      <div className="border border-border p-8 text-center">
        <Send className="h-8 w-8 mx-auto mb-4 text-accent" strokeWidth={1} />
        <p className="text-sm">Сообщение отправлено. Мы свяжемся с вами в ближайшее время.</p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="link-underline text-graphite text-[11px] uppercase tracking-[0.15em] mt-6"
        >
          Отправить ещё одно
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <input
        type="text"
        required
        placeholder="Имя"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        className="w-full border border-border px-4 py-3 text-sm focus:border-graphite outline-none"
      />
      <input
        type="text"
        required
        placeholder="Email или телефон"
        value={form.contact}
        onChange={(e) => setForm({ ...form, contact: e.target.value })}
        className="w-full border border-border px-4 py-3 text-sm focus:border-graphite outline-none"
      />
      <textarea
        required
        rows={5}
        placeholder="Сообщение"
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
        className="w-full border border-border px-4 py-3 text-sm focus:border-graphite outline-none resize-none"
      />
      <Button variant="primary" size="lg" magnetic type="submit">
        Отправить
      </Button>
    </form>
  );
}

export default function ContactsPage() {
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
            {/* TODO: заменить на реальные контакты заказчицы */}
            <ul className="space-y-6">
              <li>
                <a
                  href={CONTACT_TELEGRAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-4"
                >
                  <Send className="h-5 w-5 text-graphite mt-0.5" strokeWidth={1} />
                  <span>
                    <span className="block eyebrow text-muted mb-1">Telegram</span>
                    <span className="text-sm text-graphite link-underline">{CONTACT_TELEGRAM_HANDLE}</span>
                  </span>
                </a>
              </li>
              <li>
                <a href={CONTACT_PHONE_TEL} className="group flex items-start gap-4">
                  <Phone className="h-5 w-5 text-graphite mt-0.5" strokeWidth={1} />
                  <span>
                    <span className="block eyebrow text-muted mb-1">Телефон</span>
                    <span className="text-sm text-graphite link-underline">{CONTACT_PHONE_DISPLAY}</span>
                  </span>
                </a>
              </li>
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`} className="group flex items-start gap-4">
                  <Mail className="h-5 w-5 text-graphite mt-0.5" strokeWidth={1} />
                  <span>
                    <span className="block eyebrow text-muted mb-1">Email</span>
                    <span className="text-sm text-graphite link-underline">{CONTACT_EMAIL}</span>
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
