import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';

import { Forbidden } from '../_components/Forbidden';
import { PageHeader } from '../_components/PageHeader';
import { listSubscribers } from '@/lib/newsletter/repository';
import { formatDateTime } from '@/lib/admin/order-format';
import { ExportToolbar } from './_components/ExportToolbar';
import { SubscriberRowActions } from './_components/SubscriberRowActions';

/**
 * Раздел «Подписчики» (G-12): email-подписчики рассылки из футера витрины.
 * Доступ — право orders.read (как заявки). force-dynamic: читает БД/cookies.
 */
export const dynamic = 'force-dynamic';

export default async function SubscribersPage() {
  const user = await requireUser();
  if (!can(user, 'orders.read')) {
    return <Forbidden permission="orders.read" />;
  }

  const subscribers = await listSubscribers(500);
  // Может ли владелец выполнять действия (отписка) — отдельное право записи.
  const canWrite = can(user, 'orders.write');

  // Адреса для клиентского экспорта (копирование/CSV). Date → ISO для сериализации
  // из Server Component в Client Component (Date через границу приходит строкой).
  const exportRows = subscribers.map((s) => ({
    email: s.email,
    status: s.status,
    createdAtIso: s.created_at.toISOString(),
  }));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Подписчики"
        subtitle="Email-подписчики рассылки (форма в футере витрины)."
        breadcrumbs={[{ label: 'Подписчики' }]}
        action={<ExportToolbar rows={exportRows} />}
      />

      {subscribers.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">Пока нет подписчиков.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-4 py-2 font-medium">Дата</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Статус</th>
                {canWrite ? <th className="px-4 py-2 text-right font-medium">Действия</th> : null}
              </tr>
            </thead>
            <tbody>
              {subscribers.map((s) => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="whitespace-nowrap px-4 py-2 text-gray-600">{formatDateTime(s.created_at)}</td>
                  <td className="px-4 py-2">{s.email}</td>
                  <td className="px-4 py-2 text-gray-500">{s.status}</td>
                  {canWrite ? (
                    <td className="px-4 py-2 text-right">
                      <SubscriberRowActions id={s.id} email={s.email} status={s.status} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
