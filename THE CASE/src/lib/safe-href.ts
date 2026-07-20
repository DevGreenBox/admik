/**
 * ЗЕРКАЛО модуля admik «lib/security/safe-href.ts» (аудит 2026-07-18, находка #11).
 *
 * ПОЧЕМУ КОПИЯ, А НЕ ИМПОРТ: витрина — отдельное Next-приложение со своим tsconfig
 * и своим package.json; импорт из корня admik физически невозможен. Поэтому правила
 * продублированы руками, а совпадение поведения зафиксировано ОДИНАКОВЫМ списком
 * payload'ов в двух наборах тестов:
 *   • admik:   tests/security/safe-href.test.ts
 *   • витрина: src/lib/safe-href.test.ts
 * Правила разойдутся — упадёт один из наборов. ПРАВИШЬ ЗДЕСЬ — ПРАВЬ И ТАМ.
 *
 * РОЛЬ НА ВИТРИНЕ: это ВТОРОЙ рубеж. Admik валидирует ссылки на записи, но в БД
 * могут лежать строки, записанные до появления валидации или напрямую через SQL.
 * Guard применяется на рендере ко всем href из CMS/настроек: секции CMS, обложка
 * главной (весь первый экран — одна ссылка), меню шапки и футера.
 *
 * ЗАПРЕЩЕНО: javascript:/data:/vbscript: (регистронезависимо, устойчиво к
 * «размазыванию» схемы управляющими символами), protocol-relative «//host»,
 * ЛЮБОЙ обратный слэш «\» (WHATWG URL приравнивает его к «/» для special-схем:
 * new URL('/\evil.com', 'https://shop.ru').href === 'https://evil.com/').
 * РАЗРЕШЕНО: «/путь», «#якорь», абсолютный URL http/https/mailto/tel.
 */

/** Схемы абсолютных URL, допустимые в ссылках контента/настроек. */
const SAFE_HREF_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Разумный потолок длины (совпадает с ограничением схем CMS). */
const MAX_HREF_LENGTH = 2048;

/** Опасные схемы — с учётом ведущих пробелов/управляющих символов и регистра. */
const DANGEROUS_SCHEME_RE = /^[\u0000-\u0020]*(?:javascript|data|vbscript)[\u0000-\u0020]*:/i;

/** Любой управляющий символ, оставшийся после схлопывания TAB/LF/CR. */
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

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

/**
 * Безопасное значение либо `fallback`. Для мест, где ссылка обязана существовать
 * (обложка главной обёрнута в <Link> целиком, пункты меню) — там «не рендерить»
 * нельзя, поэтому опасное значение подменяется заведомо безопасным маршрутом.
 */
export function safeHrefOr(value: unknown, fallback: string): string {
  return safeHref(value) ?? fallback;
}
