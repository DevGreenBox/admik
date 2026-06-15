import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { sql } from '@/lib/db/client';

import { Forbidden } from '../_components/Forbidden';

/**
 * Каркас раздела «Роли» (docs/04 §6.1). МИНИМАЛЬНЫЙ список под правом
 * 'roles.manage'. Полное управление (создание ролей, привязка прав) — позже.
 *
 * force-dynamic: читает БД и сессию — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

interface RoleRow {
  id: string;
  code: string;
  title: string;
  is_system: boolean;
  permission_count: number;
}

export default async function RolesPage() {
  const user = await requireUser();
  if (!can(user, 'roles.manage')) {
    return <Forbidden permission="roles.manage" />;
  }

  const rows = await sql<RoleRow[]>`
    SELECT
      r.id,
      r.code,
      r.title,
      r.is_system,
      count(rp.permission_code)::int AS permission_count
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    GROUP BY r.id, r.code, r.title, r.is_system
    ORDER BY r.is_system DESC, r.code ASC
    LIMIT 200
  `;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Роли</h1>
      <p className="mt-2 text-sm text-gray-600">
        Каркас раздела. TODO: создание ролей и привязка прав
        (<code>role_permissions</code>). Системные роли неудаляемы.
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Код</th>
              <th scope="col" className="px-4 py-2 font-medium">Название</th>
              <th scope="col" className="px-4 py-2 font-medium">Системная</th>
              <th scope="col" className="px-4 py-2 font-medium">Прав</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  Ролей пока нет.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-800">
                      {row.code}
                    </code>
                  </td>
                  <td className="px-4 py-2 text-gray-800">{row.title}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {row.is_system ? 'да' : '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {row.permission_count}
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
