/**
 * Чистая логика отправки формы подписки футера (Находка S-nav #10).
 *
 * Вынесена из компонента, чтобы покрыть юнит-тестом в node-окружении и чтобы
 * ошибка сети/сервера НЕ проглатывалась молча: при сбое возвращаем сообщение,
 * которое футер показывает покупателю. Раньше catch был пуст → покупатель видел
 * «как будто подписался», хотя email не сохранился.
 *
 * Подписка передаётся параметром (DI) — функция не зависит от сети/React.
 */

export type NewsletterResult = { ok: true } | { ok: false; error: string };

/** Сообщение покупателю при сбое подписки (повторяемое действие). */
export const NEWSLETTER_ERROR = 'Не удалось подписаться, попробуйте позже.';

export async function submitNewsletter(
  rawEmail: string,
  subscribe: (email: string) => Promise<unknown>,
): Promise<NewsletterResult> {
  const email = rawEmail.trim();
  // Пустой email — без ошибки и без обращения к сети (нативная required-валидация
  // формы уже не даст отправить, ошибку показывать не нужно).
  if (!email) return { ok: false, error: '' };
  try {
    await subscribe(email);
    return { ok: true };
  } catch {
    return { ok: false, error: NEWSLETTER_ERROR };
  }
}
