/**
 * Чистая логика состава меню админки = f(включённые модули, права) — docs/04 §6.3.
 *
 * Меню скрывает пункты по двум независимым причинам:
 *   - модуль выключен (`isModuleEnabled`) — раздел физически отсутствует в магазине;
 *   - у пользователя нет права (`can`) — доступа к разделу нет.
 *
 * Это лишь UI-фильтр для удобства; настоящее решение о доступе принимает сервер
 * (гварды Server Actions/роутов, §5.3 «двойная защита»). Скрытие в меню защитой
 * не является.
 *
 * Функция чистая и тестируемая: окружение передаётся параметром `env`, поэтому
 * фильтрация по модулям не зависит от глобального `process.env`.
 */

import { can, type AuthUser } from '@/lib/auth/rbac';
import type { PermissionCode } from '@/lib/auth/permissions';
import { isModuleEnabled, type ModuleName } from '@/lib/config/modules';

/** Пункт навигации админки. */
export interface NavItem {
  href: string;
  label: string;
  /** Требуемое право; если не задано — доступно всем (напр. дашборд). */
  permission?: PermissionCode;
  /** Модуль, к которому относится пункт; если не задан — пункт ядра (core). */
  module?: ModuleName;
}

/**
 * Полный состав меню (docs/04 §6.3). Порядок фиксирован.
 *
 * - «Дашборд» — без права и без модуля (виден всегда).
 * - «Каталог/Заказы/Доставка/Контент» — модульные пункты (module + permission).
 * - «Пользователи/Роли/Аудит» — пункты ядра (только permission).
 *
 * На Этапе 1 реально существуют только Дашборд, Пользователи, Роли, Аудит;
 * модульные пункты — заготовки под Этапы 2–5, но логика фильтрации уже готова.
 */
export const NAV: NavItem[] = [
  { href: '/admin', label: 'Дашборд' },
  { href: '/admin/catalog', label: 'Каталог', permission: 'catalog.read', module: 'catalog' },
  { href: '/admin/orders', label: 'Заказы', permission: 'orders.read', module: 'orders' },
  { href: '/admin/promo', label: 'Промокоды', permission: 'orders.write', module: 'orders' },
  { href: '/admin/cdek', label: 'Доставка', permission: 'cdek.manage', module: 'cdek' },
  { href: '/admin/cms', label: 'Контент', permission: 'cms.read', module: 'cms' },
  { href: '/admin/users', label: 'Пользователи', permission: 'users.read' },
  { href: '/admin/roles', label: 'Роли', permission: 'roles.manage' },
  { href: '/admin/audit', label: 'Аудит', permission: 'audit.read' },
  // «Настройки» — core (без module): не прячется за флагом, которым сам управляет
  // (self-lock guard, docs/11 §5.4.5). Виден при наличии settings.manage.
  { href: '/admin/settings', label: 'Настройки', permission: 'settings.manage' },
];

/**
 * Строит видимое для пользователя меню.
 *
 * Пункт показывается, если выполнены ОБА условия:
 *   - нет модуля ИЛИ модуль включён (`isModuleEnabled(module, env)`);
 *   - нет права ИЛИ пользователь им обладает (`can(user, permission)`).
 *
 * `env` пробрасывается в `isModuleEnabled`, чтобы функция была детерминированной
 * и тестируемой (по умолчанию — `process.env`).
 */
export function buildAdminNav(
  user: AuthUser,
  env?: Record<string, string | undefined>,
): NavItem[] {
  return NAV.filter(
    (item) =>
      (!item.module || isModuleEnabled(item.module, env)) &&
      (!item.permission || can(user, item.permission)),
  );
}
