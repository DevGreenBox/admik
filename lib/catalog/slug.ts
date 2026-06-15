/**
 * Генерация ЧПУ-slug (docs/05 §4.2, §4.3, §6.3).
 *
 * Чистая, детерминированная, без побочных эффектов — целиком тестируема юнитом.
 * Уникальность slug в БД обеспечивается уникальным индексом + ретраем на уровне
 * запроса/Server Action (см. uniquifySlug), а НЕ этой функцией.
 *
 * Правила:
 *  - транслитерация кириллицы → латиница (русские названия дают читаемые ЧПУ);
 *  - нижний регистр;
 *  - пробелы и любые не [a-z0-9] → дефис;
 *  - схлопывание повторных дефисов, обрезка дефисов по краям.
 */

/**
 * Таблица транслитерации кириллицы (рус.) → латиница.
 * Покрывает строчные буквы; верхний регистр приводится к нижнему до маппинга.
 */
const CYRILLIC_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
  я: 'ya',
};

/** Транслитерирует строку: каждый кириллический символ → латинский эквивалент. */
function transliterate(input: string): string {
  let out = '';
  for (const char of input) {
    out += CYRILLIC_MAP[char] ?? char;
  }
  return out;
}

/**
 * Преобразует произвольное название в slug.
 *
 * @example
 *   slugify('Красное платье')      // 'krasnoe-plate'
 *   slugify('  Hello   World!! ')   // 'hello-world'
 *   slugify('iPhone 15 Pro')        // 'iphone-15-pro'
 */
export function slugify(input: string): string {
  const lowered = input.trim().toLowerCase();
  const latin = transliterate(lowered);
  return latin
    // всё, что не латинская буква/цифра — в дефис
    .replace(/[^a-z0-9]+/g, '-')
    // схлопнуть повторные дефисы
    .replace(/-+/g, '-')
    // обрезать дефисы по краям
    .replace(/^-+|-+$/g, '');
}

/**
 * Проверяет, что строка — корректный slug (то, что отдаёт slugify):
 * только [a-z0-9-], без ведущих/замыкающих/двойных дефисов, не пустая.
 */
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/**
 * Возвращает кандидат slug для попытки `attempt` (0-based) — для ретрая при
 * коллизии уникального индекса. attempt=0 → исходный; далее `-2`, `-3`, ...
 *
 * Server Action использует это в цикле: пытается вставить, при нарушении
 * уникальности берёт следующий кандидат. Сама уникальность — в БД.
 */
export function uniquifySlug(base: string, attempt: number): string {
  if (attempt <= 0) {
    return base;
  }
  return `${base}-${attempt + 1}`;
}
