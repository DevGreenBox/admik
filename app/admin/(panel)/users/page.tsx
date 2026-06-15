import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { sql } from '@/lib/db/client';

import { Forbidden } from '../_components/Forbidden';

/**
 * Каркас раздела «Пользователи» (docs/04 §6.1). МИНИМАЛЬНЫЙ список под правом
 * 'users.read'. Полный CRUD (создание/редактирование/отключение) — позже.
 *
 * force-dynamic: читает БД и сессию — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  status: string;
  is_owner: boolean;
}

export default async function UsersPage() {
  const user = await requireUser();
  if (!can(user, 'users.read')) {
    return <Forbidden permission="users.read" />;
  }

  const rows = await sql<UserRow[]>`
    SELECT id, email, display_name, status, is_owner
    FROM users
    ORDER BY created_at ASC
    LIMIT 200
  `;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Пользователи</h1>
      <p className="mt-2 text-sm text-gray-600">
        Каркас раздела. TODO: создание, редактирование, отключение, назначение
        ролей (право <code>users.manage</code>).
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Email</th>
              <th scope="col" className="px-4 py-2 font-medium">Имя</th>
              <th scope="col" className="px-4 py-2 font-medium">Статус</th>
              <th scope="col" className="px-4 py-2 font-medium">Владелец</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  Пользователей пока нет.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2 text-gray-800">{row.email}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {row.display_name || '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{row.status}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {row.is_owner ? 'да' : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
