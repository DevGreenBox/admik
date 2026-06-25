/**
 * Формирование CSV для экспорта адресов подписчиков (раздел «Подписчики»).
 *
 * Чистый модуль (без БД/Next) — тестируется юнит-тестом. Используется CSV-роутом
 * экспорта (app/admin/(panel)/subscribers/export/route.ts).
 *
 * Правила безопасности и совместимости:
 *  • RFC 4180: поле с запятой/кавычкой/переносом — в двойных кавычках; внутренние
 *    кавычки удваиваются. Разделитель строк — CRLF (Excel-совместимо).
 *  • Анти-CSV-инъекция (formula injection): значение, начинающееся с = + - @,
 *    префиксуется апострофом — Excel/Sheets иначе исполнят его как формулу. Это
 *    важно, т.к. email приходит из ПУБЛИЧНОЙ формы витрины (недоверенный ввод).
 */

/** MIME для отдачи файла (UTF-8). */
export const CSV_MIME = 'text/csv; charset=utf-8';

/** Символы, с которых начинается потенциальная формула (CSV-инъекция). */
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@']);

/** Экранирует одно значение поля по RFC 4180 + защита от формул-инъекций. */
function escapeField(value: string): string {
  // Защита от формул: ведущий апостроф нейтрализует исполнение в Excel/Sheets.
  let v = value;
  if (v.length > 0 && FORMULA_PREFIXES.has(v[0]!)) {
    v = `'${v}`;
  }
  // Квотируем, если есть спецсимволы (включая добавленный апостроф/CR/LF/кавычку/запятую).
  if (/["\n\r,]/.test(v) || v.startsWith("'")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/**
 * Поля строки CSV (только то, что нужно владельцу для рассылки/учёта). Тип
 * самодостаточен (не импортирует repository), чтобы модуль можно было безопасно
 * использовать и на клиенте (кнопка «Скачать CSV») без затягивания серверного sql.
 */
export interface CsvSubscriber {
  email: string;
  status: string;
  created_at: Date;
}

/**
 * Формирует CSV-текст: заголовок + строки. Дата — ISO-8601 (UTC) для
 * однозначности и совместимости с любыми таблицами/CRM.
 */
export function subscribersToCsv(rows: CsvSubscriber[]): string {
  const header = 'email,status,created_at';
  const lines = rows.map((r) =>
    [
      escapeField(r.email),
      escapeField(r.status),
      escapeField(r.created_at.toISOString()),
    ].join(','),
  );
  return [header, ...lines].join('\r\n');
}
