/**
 * Схемы заявок (G-09).
 *
 * - LeadInputSchema — приём заявки с витрины (anti-tamper/anti-spam: ограничения
 *   длины). Поля — как в форме /contacts.
 * - LeadStatusInputSchema / LeadIdInputSchema — вход админских мутаций (смена
 *   статуса / удаление). Валидируются внутри Server Action (defineAction).
 */
import { z } from 'zod';

import { LEAD_STATUSES } from './status';

export const LeadInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contact: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
});

export type LeadInput = z.infer<typeof LeadInputSchema>;

/** Вход смены статуса заявки: id заявки + целевой статус (из whitelist). */
export const LeadStatusInputSchema = z.object({
  id: z.uuid(),
  status: z.enum(LEAD_STATUSES),
});

export type LeadStatusInput = z.infer<typeof LeadStatusInputSchema>;

/** Вход действия по одной заявке (удаление). */
export const LeadIdInputSchema = z.object({
  id: z.uuid(),
});

export type LeadIdInput = z.infer<typeof LeadIdInputSchema>;
