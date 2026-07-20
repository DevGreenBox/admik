import { isIP } from 'node:net';

/**
 * Нормализация клиентского IP из заголовков прокси — dependency-free.
 *
 * НАЗНАЧЕНИЕ (1): IP, извлечённый из заголовков, попадает в колонки типа `inet`
 * (`sessions.ip`, `audit_log.ip`) и в ключи rate-limit. Заголовки подконтрольны
 * клиенту: подделать или прислать мусор тривиально. Кандидат ВАЛИДИРУЕТСЯ через
 * `node:net` `isIP()` ДО любого inet-INSERT; невалидное значение отбрасывается
 * (→ undefined), слой БД пишет `null` (колонки `inet` nullable). Лучше потерять
 * диагностический IP, чем сломать логин/аудит на кривом заголовке.
 *
 * SECURITY (2) — ДОВЕРИЕ ИСТОЧНИКУ (фикс аудита 2026-07-18, HIGH):
 * ЛЕВЫЙ сегмент `X-Forwarded-For` подконтролен клиенту — обратный прокси (Caddy)
 * лишь ДОПИСЫВАЕТ реальный IP СПРАВА, а leftmost остаётся тем, что прислал клиент.
 * Раньше отсюда брался «реальный клиент» → атакующий ротацией XFF получал свежее
 * ведро rate-limit (обход лимита публичных POST → DoS склада) и отравлял
 * `orders.ip`/`audit_log.ip`. Поэтому ПРИОРИТЕТ отдаётся заголовку `X-Real-IP`,
 * который наш trusted-прокси Caddy ПЕРЕЗАПИСЫВАЕТ значением реального пира
 * (`header_up X-Real-IP {http.request.remote.host}`, см. Caddyfile) — клиент его
 * подделать не может. `X-Forwarded-For` используется лишь как fallback для
 * окружений без нашего прокси (локальный dev/CI): там доверенной границы нет и
 * это приемлемо. За Caddy `X-Real-IP` присутствует всегда → fallback не активен.
 *
 * Функция чистая (без next/headers, БД, I/O) → тестируется в любом окружении.
 *
 * @param forwarded значение заголовка `X-Forwarded-For` (клиент-контролируемый
 *   leftmost — НЕ доверенный; fallback только вне доверенного прокси);
 * @param realIp    значение `X-Real-IP` (за Caddy перезаписан реальным IP пира —
 *   ДОВЕРЕННЫЙ источник, имеет приоритет);
 * @returns валидный IPv4/IPv6 либо `undefined`, если ни один кандидат не валиден.
 */
export function normalizeClientIp(
  forwarded: string | null | undefined,
  realIp: string | null | undefined,
): string | undefined {
  // ПРИОРИТЕТ: X-Real-IP (за Caddy перезаписан реальным IP соединения → доверенный).
  const realCandidate = realIp?.trim();
  if (realCandidate && isIP(realCandidate) !== 0) {
    return realCandidate;
  }

  // Fallback (только окружения без нашего прокси): leftmost X-Forwarded-For.
  // За Caddy сюда не доходим — X-Real-IP всегда задан.
  const xffCandidate = forwarded?.split(',')[0]?.trim();
  if (xffCandidate && isIP(xffCandidate) !== 0) {
    return xffCandidate;
  }

  // Ни один кандидат не валиден → не доверяем мусору, отдаём undefined.
  return undefined;
}

/** Минимальный контракт источника заголовков (Headers / NextRequest.headers). */
interface HeaderSource {
  get(name: string): string | null;
}

/**
 * Извлечение клиентского IP для SERVER-TO-SERVER ВЕБХУКОВ (СДЭК, Т-Банк).
 *
 * ЕДИНСТВЕННАЯ реализация: раньше `app/api/cdek/webhook/route.ts` и
 * `app/api/payments/tbank/webhook/route.ts` держали по СВОЕЙ копии `extractIp`, и
 * копии разошлись с `normalizeClientIp` — в них приоритет был ОБРАТНЫЙ (leftmost
 * `X-Forwarded-For` первым, `X-Real-IP` лишь fallback). Это ровно тот класс бага,
 * который уже стрелял в оплате: защиту чинят в одной функции, а трафик идёт через
 * двойника. Приоритет источников теперь задаётся В ОДНОМ месте — в
 * `normalizeClientIp` выше, а обе точки входа зовут эту обёртку.
 *
 * SECURITY (аудит 2026-07-18, находки #1/#3): leftmost `X-Forwarded-For` целиком
 * подконтролен клиенту (Caddy лишь ДОПИСЫВАЕТ реальный IP СПРАВА), тогда как
 * `X-Real-IP` наш прокси ПЕРЕЗАПИСЫВАЕТ реальным IP пира. При `trustProxy=true`
 * старый приоритет делал IP-whitelist обходимым заголовком
 * `X-Forwarded-For: <IP из whitelist>`, а у СДЭК спуфнутый IP ещё и уезжал в
 * `cdek_status_log.ip` (отравление аудита). Дополнительно кандидат валидируется
 * (`normalizeClientIp` → `isIP`), поэтому в whitelist и в аудит не попадёт мусор.
 *
 * КОНТРАКТ ВЕБХУКОВ (сохранён намеренно, от него зависит whitelist-слой):
 *   • `trustProxy=false` → `''` СРАЗУ, заголовки даже не читаются: вне доверенного
 *     прокси клиентские заголовки не аутентифицируют, и непустой whitelist
 *     обязан ОТКЛОНИТЬ запрос (первичная защита — секрет `?key=` / Token в теле);
 *   • при отсутствии доверенного кандидата возвращается `''`, а НЕ `undefined`.
 *
 * @param headers    источник заголовков запроса (`req.headers`);
 * @param trustProxy запрос пришёл через наш доверенный прокси
 *   (`CDEK_WEBHOOK_TRUST_PROXY` / `TBANK_WEBHOOK_TRUST_PROXY`);
 * @returns валидный IP либо `''`, если доверенного источника нет.
 */
export function extractWebhookIp(headers: HeaderSource, trustProxy: boolean): string {
  // Вне доверенного прокси заголовкам веры нет — не читаем их вовсе.
  if (!trustProxy) return '';

  return (
    normalizeClientIp(headers.get('x-forwarded-for'), headers.get('x-real-ip')) ?? ''
  );
}
