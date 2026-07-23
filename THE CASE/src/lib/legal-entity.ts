import type { AdmikSettingsDto } from './admik';

/**
 * Реквизиты продавца для подвала (правка владельца 2026-07-22, п.1).
 *
 * Закон обязывает продавца сообщать покупателю наименование, ОГРН(ИП) и адрес
 * (ст. 9 ФЗ «О защите прав потребителей»; Правила продажи при дистанционном
 * способе). Значения приходят из настроек Admik (`legal_entity`) — витрина
 * ничего не хардкодит и не подставляет заглушек: незаполненные реквизиты просто
 * не показываются, потому что показать ЧУЖИЕ или выдуманные данные хуже, чем не
 * показать никаких.
 *
 * Банковские реквизиты (`bankDetails`) сюда не приходят по контракту публичного
 * DTO — они приватные и наружу не отдаются.
 */
export interface ResolvedLegalEntity {
  name: string | null;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  legalAddress: string | null;
}

/** Пустая строка/пробелы = «не заполнено». */
function clean(v: string | null | undefined): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length > 0 ? t : null;
}

export function resolveLegalEntity(s: AdmikSettingsDto | null): ResolvedLegalEntity {
  const l = s?.legalEntity ?? null;
  return {
    name: clean(l?.name),
    inn: clean(l?.inn),
    kpp: clean(l?.kpp),
    ogrn: clean(l?.ogrn),
    legalAddress: clean(l?.legalAddress),
  };
}

/**
 * Однострочное представление для подвала: «ИП … · ИНН … · ОГРНИП … · адрес».
 * null — реквизиты не заполнены, блок в подвале не рендерится вовсе.
 *
 * Подпись ОГРН выбирается по длине номера: 15 цифр — ОГРНИП (предприниматель),
 * 13 — ОГРН (юрлицо). Так строка остаётся корректной и для ИП, и для ООО, что
 * важно для платформы: следующий магазин может быть любым.
 */
export function legalEntityLine(l: ResolvedLegalEntity): string | null {
  const parts: string[] = [];
  if (l.name) parts.push(l.name);
  if (l.inn) parts.push(`ИНН ${l.inn}`);
  if (l.kpp) parts.push(`КПП ${l.kpp}`);
  if (l.ogrn) parts.push(`${l.ogrn.length === 15 ? 'ОГРНИП' : 'ОГРН'} ${l.ogrn}`);
  if (l.legalAddress) parts.push(l.legalAddress);
  return parts.length > 0 ? parts.join(' · ') : null;
}
