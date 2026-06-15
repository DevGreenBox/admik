/**
 * Простой блок «403 — доступ запрещён» для страниц под правом.
 * Сервер уже принял решение (нет права) — показываем понятное сообщение,
 * не раскрывая внутренних деталей.
 */
export function Forbidden({ permission }: { permission: string }) {
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-6">
      <h1 className="text-xl font-semibold text-red-800">
        403 — Доступ запрещён
      </h1>
      <p className="mt-2 text-sm text-red-700">
        Для просмотра этого раздела требуется право «{permission}».
      </p>
    </div>
  );
}
