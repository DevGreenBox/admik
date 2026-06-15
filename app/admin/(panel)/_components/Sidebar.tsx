import Link from 'next/link';

import type { NavItem } from '@/lib/admin/nav';

/**
 * Боковая навигация админки (серверный компонент). Получает уже отфильтрованный
 * по модулям и правам список пунктов (buildAdminNav) — сам решений о доступе не
 * принимает. Семантика a11y: <nav aria-label> + список ссылок.
 */
export function Sidebar({ items }: { items: NavItem[] }) {
  return (
    <nav
      aria-label="Основная навигация"
      className="w-60 shrink-0 border-r border-gray-200 bg-gray-50 p-4"
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 hover:text-gray-900"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
