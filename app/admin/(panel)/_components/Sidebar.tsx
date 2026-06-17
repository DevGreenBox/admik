'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { NavItem } from '@/lib/admin/nav';

/**
 * Боковая навигация админки. Получает уже отфильтрованный по модулям и правам
 * список пунктов (buildAdminNav) — сам решений о доступе не принимает.
 *
 * Клиентский компонент: подсвечивает АКТИВНЫЙ раздел по текущему пути
 * (usePathname) — раньше подсветки не было и владелец не понимал, где он
 * находится. «Дашборд» (`/admin`) активен только при точном совпадении; прочие
 * пункты — также на вложенных страницах (напр. `/admin/catalog/products/...`).
 * Семантика a11y: <nav aria-label> + aria-current на активной ссылке.
 */
export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      aria-label="Основная навигация"
      className="w-60 shrink-0 border-r border-gray-200 bg-gray-50 p-4"
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-md px-3 py-2 text-sm font-medium ${
                  active
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-700 hover:bg-gray-200 hover:text-gray-900'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
