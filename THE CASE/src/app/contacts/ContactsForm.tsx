"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Клиентская форма обратной связи. Пока заявки никуда не уходят (заглушка) —
 * приём заявок (эндпоинт + раздел в админке) делается в волне P3 (G-09).
 */
export function ContactsForm() {
  const [form, setForm] = useState({ name: "", contact: "", message: "" });
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO(G-09, волна P3): подключить реальный приём заявок. Пока — клиентская
    // заглушка с состоянием «отправлено» (паттерн форм витрины, ср. Footer newsletter).
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
