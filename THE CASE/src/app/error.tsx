"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container-brand section-space text-center">
      <p className="eyebrow mb-6">Ошибка</p>
      <h1 className="heading-lg heading-rule mb-6">Страница не загрузилась</h1>
      <p className="body-editorial mx-auto mb-10 max-w-md text-muted">
        Попробуйте обновить страницу. Если проблема повторяется — проверьте доступность бэкенда
        Admik и переменные окружения (ADMIK_API_URL, NEXT_PUBLIC_ADMIK_API_URL).
      </p>
      <button type="button" onClick={reset} className="link-editorial">
        Обновить
      </button>
      {process.env.NODE_ENV === "development" && (
        <pre className="mt-8 text-left text-xs text-muted overflow-auto">{error.message}</pre>
      )}
    </div>
  );
}
