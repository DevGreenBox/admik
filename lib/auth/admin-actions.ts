'use server';

import type { TransactionSql } from 'postgres';

import { defineAction, PublicActionError, type ActionCtx } from '@/lib/server/action';
import { sql } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';
import { ALL_PERMISSIONS } from '@/lib/auth/permissions';

import {
  UserCreateSchema,
  UserUpdateSchema,
  UserPasswordResetSchema,
  RoleCreateSchema,
  RoleUpdateSchema,
  RoleIdSchema,
} from './admin-schemas';
import { assignUserRoles, setRolePermissions } from './admin-repository';

/**
 * Server Actions управления пользователями и ролями (docs/04 §6.1).
 *
 * Все мутации — через единый пайплайн defineAction (§4.7): guard (users.manage /
 * roles.manage) → Zod → handler (БД через sql, параметризовано) → revalidate →
 * audit. Чувствительные поля (пароль/хеш) НИКОГДА не уходят в аудит — пишем
 * только безопасные снимки; санитайзер аудита дополнительно вырезает секреты.
 *
 * Бизнес-отказы, которые надо показать владельцу понятной фразой (дубликат
 * email, защита владельца), бросаются как PublicActionError — пайплайн отдаёт
 * их текст в форму.
 */

// -----------------------------------------------------------------------------
// Общие хелперы.
// -----------------------------------------------------------------------------

/** Пути инвалидации разделов. */
const USERS_PATH = '/admin/users';
const ROLES_PATH = '/admin/roles';

/** Код нарушения уникальности PostgreSQL. */
const PG_UNIQUE_VIOLATION = '23505';

/** true, если ошибка — нарушение уникального индекса. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}

/** Множество известных кодов прав — фильтр против неизвестных (FK на permissions). */
const KNOWN_PERMISSION_CODES = new Set<string>(ALL_PERMISSIONS.map((p) => p.code));

/** Оставляет только существующие коды прав (защита от мусора/FK-нарушения). */
function filterKnownPermissions(codes: string[]): string[] {
  return codes.filter((c) => KNOWN_PERMISSION_CODES.has(c));
}

// =============================================================================
// ПОЛЬЗОВАТЕЛИ.
// =============================================================================

export const createUser = defineAction({
  permission: 'users.manage',
  input: UserCreateSchema,
  handler: async (data, _ctx: ActionCtx) => {
    const passwordHash = await hashPassword(data.password);

    let userId: string;
    try {
      userId = await sql.begin(async (tx: TransactionSql) => {
        const rows = await tx<{ id: string }[]>`
          INSERT INTO users (email, password_hash, display_name, status)
          VALUES (${data.email}, ${passwordHash}, ${data.displayName}, ${data.status})
          RETURNING id
        `;
        const id = rows[0]!.id;
        await assignUserRoles(tx, id, data.roleIds);
        return id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new PublicActionError('Пользователь с таким email уже существует.');
      }
      throw err;
    }

    return {
      result: { id: userId },
      revalidate: [USERS_PATH],
      audit: {
        action: 'user.create',
        entityType: 'user',
        entityId: userId,
        // Пароль/хеш в аудит НЕ пишем — только безопасные поля.
        after: {
          email: data.email,
          displayName: data.displayName,
          status: data.status,
          roleIds: data.roleIds,
        },
      },
    };
  },
});

export const updateUser = defineAction({
  permission: 'users.manage',
  input: UserUpdateSchema,
  handler: async (data, ctx: ActionCtx) => {
    const before = await sql<
      { id: string; email: string; display_name: string; status: string; is_owner: boolean }[]
    >`
      SELECT id, email, display_name, status, is_owner
      FROM users WHERE id = ${data.id} LIMIT 1
    `;
    if (!before[0]) {
      throw new PublicActionError('Пользователь не найден.');
    }

    // Защита владельца: учётку владельца через UI не меняем (RBAC §5.4).
    if (before[0].is_owner) {
      throw new PublicActionError('Владельца магазина нельзя изменять или отключать.');
    }

    // Нельзя отключить самого себя — иначе можно потерять доступ к админке.
    const disablingSelf =
      data.id === ctx.user.id && data.status !== undefined && data.status !== 'active';
    if (disablingSelf) {
      throw new PublicActionError('Нельзя отключить собственную учётную запись.');
    }

    await sql.begin(async (tx: TransactionSql) => {
      await tx`
        UPDATE users SET
          display_name = COALESCE(${data.displayName ?? null}, display_name),
          status       = COALESCE(${data.status ?? null}, status),
          updated_at   = now()
        WHERE id = ${data.id}
      `;
      if (data.roleIds !== undefined) {
        await assignUserRoles(tx, data.id, data.roleIds);
      }
    });

    return {
      result: { id: data.id },
      revalidate: [USERS_PATH],
      audit: {
        action: 'user.update',
        entityType: 'user',
        entityId: data.id,
        before: {
          displayName: before[0].display_name,
          status: before[0].status,
        },
        after: {
          displayName: data.displayName ?? before[0].display_name,
          status: data.status ?? before[0].status,
          roleIds: data.roleIds,
        },
      },
    };
  },
});

export const resetUserPassword = defineAction({
  permission: 'users.manage',
  input: UserPasswordResetSchema,
  handler: async (data, _ctx: ActionCtx) => {
    const passwordHash = await hashPassword(data.password);
    const rows = await sql<{ id: string }[]>`
      UPDATE users SET password_hash = ${passwordHash}, updated_at = now()
      WHERE id = ${data.id}
      RETURNING id
    `;
    if (!rows[0]) {
      throw new PublicActionError('Пользователь не найден.');
    }
    return {
      result: { id: data.id },
      revalidate: [USERS_PATH],
      audit: {
        // Новый пароль/хеш в аудит НЕ попадают — фиксируем лишь факт сброса.
        action: 'user.password.reset',
        entityType: 'user',
        entityId: data.id,
      },
    };
  },
});

// =============================================================================
// РОЛИ.
// =============================================================================

export const createRole = defineAction({
  permission: 'roles.manage',
  input: RoleCreateSchema,
  handler: async (data, _ctx: ActionCtx) => {
    const codes = filterKnownPermissions(data.permissionCodes);

    let roleId: string;
    try {
      roleId = await sql.begin(async (tx: TransactionSql) => {
        const rows = await tx<{ id: string }[]>`
          INSERT INTO roles (code, title, is_system)
          VALUES (${data.code}, ${data.title}, false)
          RETURNING id
        `;
        const id = rows[0]!.id;
        await setRolePermissions(tx, id, codes);
        return id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new PublicActionError('Роль с таким кодом уже существует.');
      }
      throw err;
    }

    return {
      result: { id: roleId },
      revalidate: [ROLES_PATH],
      audit: {
        action: 'role.create',
        entityType: 'role',
        entityId: roleId,
        after: { code: data.code, title: data.title, permissionCodes: codes },
      },
    };
  },
});

export const updateRole = defineAction({
  permission: 'roles.manage',
  input: RoleUpdateSchema,
  handler: async (data, _ctx: ActionCtx) => {
    const before = await sql<{ id: string; code: string; title: string; is_system: boolean }[]>`
      SELECT id, code, title, is_system FROM roles WHERE id = ${data.id} LIMIT 1
    `;
    if (!before[0]) {
      throw new PublicActionError('Роль не найдена.');
    }
    // Системную роль править можно (название/права), но НЕ её код — он неизменяем
    // в принципе (схема UpdateSchema его не принимает).
    const codes =
      data.permissionCodes !== undefined
        ? filterKnownPermissions(data.permissionCodes)
        : undefined;

    await sql.begin(async (tx: TransactionSql) => {
      await tx`
        UPDATE roles SET
          title      = COALESCE(${data.title ?? null}, title),
          updated_at = now()
        WHERE id = ${data.id}
      `;
      if (codes !== undefined) {
        await setRolePermissions(tx, data.id, codes);
      }
    });

    return {
      result: { id: data.id },
      revalidate: [ROLES_PATH],
      audit: {
        action: 'role.update',
        entityType: 'role',
        entityId: data.id,
        before: { title: before[0].title },
        after: {
          title: data.title ?? before[0].title,
          permissionCodes: codes,
        },
      },
    };
  },
});

export const deleteRole = defineAction({
  permission: 'roles.manage',
  input: RoleIdSchema,
  handler: async (data, _ctx: ActionCtx) => {
    const before = await sql<{ id: string; code: string; is_system: boolean }[]>`
      SELECT id, code, is_system FROM roles WHERE id = ${data.id} LIMIT 1
    `;
    if (!before[0]) {
      throw new PublicActionError('Роль не найдена.');
    }
    if (before[0].is_system) {
      throw new PublicActionError('Системную роль удалить нельзя.');
    }
    // ON DELETE CASCADE снимет привязки role_permissions и user_roles.
    await sql`DELETE FROM roles WHERE id = ${data.id}`;

    return {
      result: { id: data.id },
      revalidate: [ROLES_PATH],
      audit: {
        action: 'role.delete',
        entityType: 'role',
        entityId: data.id,
        before: { code: before[0].code },
      },
    };
  },
});
