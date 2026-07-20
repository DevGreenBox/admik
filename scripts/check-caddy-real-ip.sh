#!/usr/bin/env bash
# =============================================================================
# check-caddy-real-ip.sh — линтер конфигурации обратного прокси (Caddy)
# =============================================================================
# ЗАЧЕМ. Безопасность кода admik опирается на допущение о КОНФИГЕ: приложение
# доверяет заголовку `X-Real-IP` (lib/server/request-ip.ts → normalizeClientIp,
# extractWebhookIp), потому что обратный прокси ПЕРЕЗАПИСЫВАЕТ его реальным IP
# соединения. Клиент подделать такой заголовок не может — в отличие от leftmost
# `X-Forwarded-For`, который прокси лишь ДОПИСЫВАЕТ справа.
#
# Если новый `reverse_proxy` заведут без `header_up X-Real-IP`, код останется
# правильным, а защита исчезнет: приложение свалится на fallback (leftmost XFF)
# и вернутся находки #1/#3 аудита 2026-07-18 —
#   • IP-whitelist вебхуков СДЭК/Т-Банка обходится заголовком;
#   • rate-limit обходится ротацией XFF;
#   • в `audit_log.ip` / `orders.ip` / `cdek_status_log.ip` пишется чужой IP.
# Юнит-тесты кода этого не ловят. Поэтому конфиг проверяется отдельным гейтом.
#
# КОНТРАКТ:
#   • DEFAULT-DENY: КАЖДЫЙ `reverse_proxy` обязан иметь внутри своего блока
#     `header_up X-Real-IP {http.request.remote.host}` — включая upstream'ы,
#     о которых линтер ничего не знает (новый сервис не должен проскочить молча);
#   • исключение — только перечисленные не-приложенческие upstream'ы: они не
#     принимают решений по IP (по умолчанию `minio` — раздача медиа). Список
#     переопределяется переменной окружения CADDY_REALIP_EXEMPT (ERE-альтернатива,
#     например `minio|cdn`) — имена контейнеров различаются между магазинами;
#   • значение обязано браться из `{http.request.remote.host}` (адрес соединения).
#     Проброс клиентского заголовка (`{http.request.header.*}`) — это ровно та
#     дыра, которую чинили, и он отвергается;
#   • нарушение → exit 1 со списком строк.
#
# ИСПОЛЬЗОВАНИЕ:
#   ./scripts/check-caddy-real-ip.sh [путь/к/Caddyfile]     # по умолчанию ./Caddyfile
#   CADDY_REALIP_EXEMPT='minio|cdn' ./scripts/check-caddy-real-ip.sh
# Зависимости: bash + awk. Docker/Caddy не нужны — проверка статическая.
# =============================================================================
set -uo pipefail

CADDYFILE="${1:-Caddyfile}"
EXEMPT="${CADDY_REALIP_EXEMPT:-minio}"

if [[ ! -f "$CADDYFILE" ]]; then
  echo "  ✗ Caddyfile не найден: $CADDYFILE" >&2
  echo "  ✗ Гейт X-Real-IP не может быть подтверждён — считаем это провалом." >&2
  exit 1
fi

awk -v exempt="$EXEMPT" '
# --- состояние ---------------------------------------------------------------
# in_rp   : находимся внутри блока reverse_proxy { ... }
# depth   : глубина вложенности фигурных скобок внутри этого блока
# found   : в текущем блоке встречен корректный header_up X-Real-IP
# badsrc  : в текущем блоке X-Real-IP берётся НЕ из remote.host
BEGIN { violations = 0 }

# Комментарии Caddy — «#» до конца строки. Срезаем, чтобы закомментированный
# reverse_proxy не считался маршрутом, а комментарий-подсказка — заголовком.
{ line = $0; sub(/#.*/, "", line) }

# --- внутри блока reverse_proxy ---------------------------------------------
in_rp {
  if (line ~ /header_up[ \t]+[Xx]-[Rr]eal-[Ii][Pp]/) {
    if (line ~ /\{http\.request\.remote\.host\}/) found = 1; else badsrc = 1
  }
  depth += gsub(/\{/, "{", line)
  depth -= gsub(/\}/, "}", line)
  if (depth <= 0) {
    in_rp = 0
    report(found, badsrc)
  }
  next
}

# --- начало маршрута ---------------------------------------------------------
line ~ /(^|[ \t;])reverse_proxy[ \t]/ {
  rp_line = NR
  rp_text = $0
  sub(/^[ \t]+/, "", rp_text)

  # upstream — первый токен после reverse_proxy (без флагов вида "to").
  up = line
  sub(/.*reverse_proxy[ \t]+/, "", up)
  sub(/[ \t].*$/, "", up)
  sub(/\{.*$/, "", up)
  host = up
  sub(/:[0-9]+$/, "", host)          # отбрасываем порт
  sub(/^[a-zA-Z]+:\/\//, "", host)   # и схему, если указана

  # Исключения: не-приложенческие upstream (медиа и т.п.) решений по IP не принимают.
  if (exempt != "" && host ~ ("^(" exempt ")$")) next

  found = 0; badsrc = 0
  # Однострочный `reverse_proxy X` без блока — заголовка быть не может.
  if (line !~ /\{[ \t]*$/) { report(0, 0); next }
  in_rp = 1
  depth = 1
  next
}

function report(f, b,   why) {
  if (f && !b) return
  if (b) why = "X-Real-IP берётся НЕ из {http.request.remote.host} (клиентский заголовок подделывается)"
  else   why = "нет header_up X-Real-IP {http.request.remote.host}"
  printf("  ✗ %s:%d: %s\n", FILENAME, rp_line, why)
  printf("        %s\n", rp_text)
  violations++
}

END {
  if (in_rp) report(found, badsrc)   # незакрытый блок в конце файла
  if (violations > 0) {
    printf("  ✗ reverse_proxy без доверенного X-Real-IP: %d.\n", violations)
    print  "     Приложение доверяет X-Real-IP (lib/server/request-ip.ts); без header_up"
    print  "     оно свалится на клиентский X-Forwarded-For → обход IP-whitelist вебхуков"
    print  "     и rate-limit, отравление audit_log.ip."
    print  "     Починка: добавьте в блок `header_up X-Real-IP {http.request.remote.host}`,"
    print  "     либо внесите не-приложенческий upstream в CADDY_REALIP_EXEMPT."
    exit 1
  }
  printf("  ✓ Caddy: у каждого reverse_proxy в приложение задан доверенный X-Real-IP (%s).\n", FILENAME)
}
' "$CADDYFILE"
