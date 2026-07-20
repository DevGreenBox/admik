/**
 * ЕДИНЫЙ источник правды о безопасности href (аудит 2026-07-18, находка #11).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Раньше проверка ссылки существовала в ДВУХ независимых
 * копиях с РАЗНЫМИ правилами: `hrefSchema` в lib/cms/schemas.ts и одноимённая
 * `hrefSchema` в lib/settings/schemas.ts. Вторая была слабее (регулярка вместо
 * разбора URL) и пропускала protocol-relative `//evil.com` — а через неё идёт
 * ссылка ГЕРОЯ главной страницы, в которую обёрнут весь первый экран витрины.
 * Обе копии сведены сюда: правило меняется в одном месте — меняется везде.
 *
 * ЧТО ЗАПРЕЩЕНО И ПОЧЕМУ:
 *  • `javascript:` / `data:` / `vbscript:` — хранимый XSS при клике по ссылке.
 *    Проверка регистронезависима и устойчива к «размазыванию» схемы управляющими
 *    символами (`java\nscript:`): WHATWG URL-парсер выбрасывает TAB/LF/CR из
 *    значения, поэтому мы схлопываем их ПЕРЕД сверкой схемы.
 *  • protocol-relative `//host` — open-redirect: браузер подставит текущую схему.
 *  • ЛЮБОЙ обратный слэш `\` — для special-схем WHATWG URL приравнивает `\` к `/`:
 *    `new URL('/\evil.com', 'https://shop.ru').href === 'https://evil.com/'`.
 *    Это ровно тот обход, из-за которого находка #11 была закрыта лишь частично:
 *    условие `v.startsWith('/') && !v.startsWith('//')` для `/\evil.com` истинно,
 *    и Next рендерил `<a href="/\evil.com">` дословно.
 *
 * ЧТО РАЗРЕШЕНО: корневой относительный путь `/…`, якорь `#…`, абсолютный URL со
 * схемой http/https/mailto/tel.
 *
 * ВНИМАНИЕ ПРИ ПРАВКЕ: у витрины («THE CASE/») отдельный tsconfig и импорт из
 * корня admik НЕВОЗМОЖЕН — там лежит ЗЕРКАЛО этого модуля,
 * «THE CASE/src/lib/safe-href.ts», со своим тестом. Любое изменение правил здесь
 * обязано быть повторено там (оба набора тестов используют один список payload'ов).
 */

/** Схемы абсолютных URL, допустимые в ссылках контента/настроек. */
const SAFE_HREF_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Разумный потолок длины (совпадает с ограничением схем CMS). */
const MAX_HREF_LENGTH = 2048;

/** Опасные схемы — с учётом ведущих пробелов/управляющих символов и регистра. */
const DANGEROUS_SCHEME_RE = /^[\u0000-\u0020]*(?:javascript|data|vbscript)[\u0000-\u0020]*:/i;

/** Любой управляющий символ, оставшийся после схлопывания TAB/LF/CR. */
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

/** Человекочитаемое сообщение об ошибке для Zod-схем (одно на обе схемы). */
export const SAFE_HREF_MESSAGE =
  'Укажите путь от «/» (например /catalog или /#delivery), якорь «#…» либо полный URL со схемой http/https/mailto/tel';

/**
 * Истина, если значение безопасно подставлять в `href`/`<Link href>`.
 * Строгая: всё, что не распознано как безопасное, отвергается.
 */
export function isSafeHref(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  const raw = value.trim();
  if (raw.length === 0 || raw.length > MAX_HREF_LENGTH) return false;

  // WHATWG URL-парсер удаляет TAB/LF/CR из ЛЮБОЙ позиции значения, поэтому сверять
  // схему нужно по схлопнутой строке: 'java\nscript:alert(1)' → 'javascript:alert(1)'.
  const collapsed = raw.replace(/[\t\n\r]/g, '');
  if (collapsed.length === 0) return false;

  // Обратный слэш эквивалентен прямому для special-схем → обход запрета '//host'.
  if (collapsed.includes('\\')) return false;
  if (CONTROL_CHAR_RE.test(collapsed)) return false;
  if (DANGEROUS_SCHEME_RE.test(collapsed)) return false;

  if (collapsed.startsWith('#')) return true; // якорь на текущей странице
  if (collapsed.startsWith('//')) return false; // protocol-relative → open-redirect
  if (collapsed.startsWith('/')) return true; // корневой относительный путь

  try {
    return SAFE_HREF_SCHEMES.has(new URL(collapsed).protocol);
  } catch {
    return false; // не URL и не относительный путь ('catalog', 'www.site.ru') → 404/риск
  }
}

/**
 * Нормализованное безопасное значение либо `null` (ссылку не рендерим).
 * Применяется на РЕНДЕРЕ — как второй рубеж для строк, уже лежащих в БД
 * (записанных до появления валидации или напрямую через SQL).
 */
export function safeHref(value: unknown): string | null {
  return isSafeHref(value) ? (value as string).trim() : null;
}
