"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { submitLead } from "@/lib/admik";

/**
 * Клиентская форма обратной связи (G-09): отправляет заявку на Storefront API
 * (POST /leads), владелец видит её в админке (раздел «Заявки»). Браузерный запрос
 * авторизуется по Origin (без ключа). Сбой — мягкая ошибка с предложением связаться напрямую.
 */
export function ContactsForm() {
  const [form, setForm] = useState({ name: "", contact: "", message: "" });
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await submitLead({ name: form.name, contact: form.contact, message: form.message });
      setSent(true);
      setForm({ name: "", contact: "", message: "" });
    } catch {
      setError("Не удалось отправить. Попробуйте позже или напишите нам напрямую.");
    } finally {
      setPending(false);
    }
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
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button variant="primary" size="lg" magnetic type="submit" disabled={pending}>
        {pending ? "Отправка…" : "Отправить"}
      </Button>
    </form>
  );
}
