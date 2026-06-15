import { requireUser } from '@/lib/auth/session';

/**
 * Дашборд-заглушка (docs/04 §6.4). Приветствие пользователя + плейсхолдеры
 * метрик. Наполнится данными в модулях (Этапы 2–5).
 *
 * force-dynamic: страница зависит от сессии (cookie) — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

/** Плейсхолдер карточки метрики. */
function MetricCard({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
      <h2 className="text-sm font-medium text-gray-500">{title}</h2>
      <p className="mt-2 text-2xl font-semibold text-gray-300">—</p>
      <p className="mt-1 text-xs text-gray-400">Данные появятся в модулях</p>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Дашборд</h1>
      <p className="mt-2 text-gray-600">
        Здравствуйте, <span className="font-medium">{user.email}</span>.
      </p>

      <section
        aria-label="Метрики"
        className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <MetricCard title="Заказы за сегодня" />
        <MetricCard title="Выручка за сегодня" />
        <MetricCard title="Товары в каталоге" />
      </section>
    </div>
  );
}
