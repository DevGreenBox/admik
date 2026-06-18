/**
 * Русское склонение существительного по числу.
 * forms = [для 1 (кроме 11): «результат»,
 *          для 2–4 (кроме 12–14): «результата»,
 *          для 0, 5–20, …: «результатов»].
 *
 * Общий помощник (не дублировать правило mod10/mod100 по компонентам).
 */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}
