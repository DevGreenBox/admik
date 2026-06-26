import Link from 'next/link';

import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { sql } from '@/lib/db/client';
import { auditActionLabel, auditEntityTypeLabel } from '@/lib/admin/audit-labels';

import { Forbidden } from '../_components/Forbidden';
import { PageHeader } from '../_components/PageHeader';

/**
 * Просмотр журнала аудита (docs/04 §7, задача 1.4/1.5). Под правом 'audit.read'.
 *
 * Сервер — единственный источник решения о доступе: проверяем can() и при
 * отсутствии права рендерим 403 (UI-скрытие в меню защитой не является, §5.3).
 *
 * Читаемость (находка #17): колонка «Действие» показывает русскую подпись
 * (auditActionLabel), а не сырой код; «Сущность» — русский тип + понятное имя
 * (email пользователя / название роли), uuid уезжает в tooltip. Жёсткий LIMIT=100
 * заменён offset-пагинацией с общим счётчиком, чтобы старые записи были доступны.
 *
 * force-dynamic: страница читает БД и сессию — не пререндерить при build.
 */
export const dynamic = 'force-dynamic';

/** Размер страницы журнала (offset-пагинация). */
const PAGE_SIZE = 50;

/** UUID v4-подобный (анти-cast-error: в ::uuid[] пускаем только валидные id). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Строка журнала для таблицы. */
interface AuditRow {
  id: string;
  created_at: Date;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
}

/** Форматирует время записи в локали ru (московское время — привычнее владельцу). */
function formatTime(value: Date): string {
  return new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

/** Короткий вид uuid для подписи (полный — в title-tooltip). */
function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Подтягивает понятные имена сущностей по id: email для пользователей, title для
 * ролей. Возвращает Map<entity_id, name>. Только для валидных uuid (cast-safe).
 */
async function resolveEntityNames(rows: AuditRow[]): Promise<Map<string, string>> {
  const collect = (type: string): string[] => [
    ...new Set(
      rows
        .filter((r) => r.entity_type === type && r.entity_id && UUID_RE.test(r.entity_id))
        .map((r) => r.entity_id as string),
    ),
  ];
  const userIds = collect('user');
  const roleIds = collect('role');

  const [userRows, roleRows] = await Promise.all([
    userIds.length
      ? sql<{ id: string; email: string }[]>`
          SELECT id::text AS id, email FROM users WHERE id = ANY(${userIds}::uuid[])
        `
      : Promise.resolve([] as { id: string; email: string }[]),
    roleIds.length
      ? sql<{ id: string; title: string }[]>`
          SELECT id::text AS id, title FROM roles WHERE id = ANY(${roleIds}::uuid[])
        `
      : Promise.resolve([] as { id: string; title: string }[]),
  ]);

  const map = new Map<string, string>();
  for (const u of userRows) map.set(u.id, u.email);
  for (const r of roleRows) map.set(r.id, r.title);
  return map;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user, 'audit.read')) {
    return <Forbidden permission="audit.read" />;
  }

  const sp = await searchParams;
  const pageRaw = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page ?? '1');
  const requestedPage = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  // Сначала считаем всего, чтобы заклампить страницу: ?page за пределами раньше
  // давал ПУСТУЮ таблицу при заголовке «Страница N из N» (offset брался от
  // незаклампленной page) — фикс ревью Batch 6: offset считаем от currentPage,
  // overshoot показывает последнюю реальную страницу.
  const totalRows = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM audit_log`;
  const total = Number(totalRows[0]?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;

  const rows = await sql<AuditRow[]>`
    SELECT id, created_at, actor_email, action, entity_type, entity_id
    FROM audit_log
    ORDER BY created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `;
  const names = await resolveEntityNames(rows);

  const pageHref = (p: number): string => `/admin/audit?page=${p}`;

  return (
    <div>
      <PageHeader
        title="Журнал аудита"
        subtitle={`Всего событий: ${total}. Страница ${currentPage} из ${totalPages}.`}
        breadcrumbs={[{ label: 'Аудит' }]}
      />

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Время (МСК)</th>
              <th scope="col" className="px-4 py-2 font-medium">Инициатор</th>
              <th scope="col" className="px-4 py-2 font-medium">Действие</th>
              <th scope="col" className="px-4 py-2 font-medium">Сущность</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  Записей пока нет.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const name = row.entity_id ? names.get(row.entity_id) : undefined;
                return (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-700">
                      {formatTime(row.created_at)}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{row.actor_email ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-800" title={row.action}>
                      {auditActionLabel(row.action)}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {row.entity_type ? (
                        <span>
                          <span className="text-gray-500">
                            {auditEntityTypeLabel(row.entity_type)}
                          </span>
                          {name ? (
                            <span className="ml-1 text-gray-900">{name}</span>
                          ) : row.entity_id ? (
                            <code
                              className="ml-1 rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-400"
                              title={row.entity_id}
                            >
                              {shortId(row.entity_id)}
                            </code>
                          ) : null}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Пагинация">
          <span className="text-gray-500">
            Страница {currentPage} из {totalPages}
          </span>
          <div className="flex gap-2">
            {currentPage > 1 ? (
              <Link
                href={pageHref(currentPage - 1)}
                className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-100"
              >
                Назад
              </Link>
            ) : null}
            {currentPage < totalPages ? (
              <Link
                href={pageHref(currentPage + 1)}
                className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-100"
              >
                Вперёд
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
