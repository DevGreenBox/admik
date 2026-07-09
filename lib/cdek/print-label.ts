/**
 * Чистая логика кнопок «печать накладной/ШК» в UI (находка #12 + боевой гэп №3
 * аудита 2026-07-09).
 *
 * История:
 *   • #12 (mock): print_url = https://example.invalid/... — window.open открывал
 *     мёртвую вкладку → в mock показываем пояснение и НИЧЕГО не открываем.
 *   • Гэп №3 (боевой): прямой URL СДЭК (api.cdek.ru/...pdf) требует
 *     Bearer-токен и живёт ~1 час — браузер админа получал 401. Теперь UI
 *     открывает НАШ авторизованный серверный прокси /admin/cdek/label
 *     (route выкачивает PDF с токеном и отдаёт файл), а прямые ссылки на
 *     api.cdek.ru из UI убраны.
 *
 * Чистые функции, тестируемы без браузера/Next.
 */

import type { PrintKind } from './services/print';

/** Пояснение для mock-режима (почему вкладка с PDF не открывается). */
export const MOCK_LABEL_NOTICE =
  'MOCK-режим: реальная накладная появится в боевом режиме (с боевыми ключами СДЭК).';

/**
 * Same-origin адрес серверного PDF-прокси печати (route
 * app/admin/(panel)/cdek/label). Оба параметра экранируются.
 */
export function labelProxyUrl(orderId: string, kind: PrintKind): string {
  const q = new URLSearchParams({ orderId, kind });
  return `/admin/cdek/label?${q.toString()}`;
}

/** Исход клика по кнопке печати. */
export interface PrintClickOutcome {
  /** Открывать ли url в новой вкладке (только боевой режим). */
  open: boolean;
  /** Адрес серверного прокси (null в mock). */
  url: string | null;
  /** Сообщение пользователю (null — без сообщения). */
  message: string | null;
}

/**
 * Решает исход клика по кнопке печати:
 *   - mock   → не открывать, пояснить про боевой режим;
 *   - боевой → открыть серверный прокси (PDF отдаётся с Bearer на сервере).
 */
export function resolvePrintClick(
  label: string,
  input: { isMock: boolean; orderId: string; kind: PrintKind },
): PrintClickOutcome {
  if (input.isMock) {
    return { open: false, url: null, message: `${label}: ${MOCK_LABEL_NOTICE}` };
  }
  return {
    open: true,
    url: labelProxyUrl(input.orderId, input.kind),
    message: `${label}: PDF откроется в новой вкладке.`,
  };
}
