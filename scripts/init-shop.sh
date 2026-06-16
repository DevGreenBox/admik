#!/usr/bin/env bash
# shellcheck disable=SC2059  # printf-форматы содержат только статические ANSI-цвета (без % и пользовательских данных)
# =============================================================================
# Admik — инициализация нового магазина (init-shop)
# =============================================================================
# Этот скрипт запускает НЕ разработчик, а сторонний человек при развёртывании
# нового магазина. Поэтому каждый шаг подробно прокомментирован и выводит
# понятные сообщения.
#
# Что делает скрипт:
#   1. Проверяет, что файл .env существует и заполнен.
#   2. Ждёт, пока база данных PostgreSQL станет доступна.
#   3. Накатывает миграции из db/migrations/*.sql (идемпотентно — повторный
#      запуск безопасен).
#   4. Заполняет начальные данные (seed): права, роли, владелец.
#   5. ОПЦИОНАЛЬНО (если SEED_DEMO_CATALOG=true) — наполняет демо-каталогом.
#
# Скрипт ИДЕМПОТЕНТЕН: его можно запускать повторно без вреда для данных.
#
# Запуск:
#   ./scripts/init-shop.sh
# =============================================================================

# Строгий режим: падать при ошибке, при обращении к необъявленной переменной
# и при ошибке в любой команде конвейера.
set -euo pipefail

# Цвета для наглядного вывода (если терминал поддерживает).
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BOLD=''; NC=''
fi

# Вспомогательные функции вывода шагов.
step()  { printf "${BOLD}==>${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}  ✔${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}  ⚠${NC} %s\n" "$1"; }
fail()  { printf "${RED}  ✗${NC} %s\n" "$1" >&2; }

# Определяем корень проекта (на уровень выше каталога scripts),
# чтобы скрипт работал из любой директории.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

MIGRATIONS_DIR="${PROJECT_ROOT}/db/migrations"

printf "${BOLD}=== Admik · инициализация магазина ===${NC}\n\n"

# -----------------------------------------------------------------------------
# Шаг 1. Проверка файла конфигурации .env
# -----------------------------------------------------------------------------
step "Шаг 1/5. Проверяю конфигурацию (.env)"

if [ ! -f "${PROJECT_ROOT}/.env" ]; then
  fail "Файл .env не найден."
  warn "Скопируйте шаблон и заполните значения:"
  warn "    cp .env.example .env"
  exit 1
fi

# Подгружаем переменные из .env в окружение скрипта.
# set -a включает авто-экспорт всех присваиваемых переменных.
set -a
# shellcheck disable=SC1091
. "${PROJECT_ROOT}/.env"
set +a

# Проверяем, что заданы критичные переменные подключения к БД.
MISSING=""
[ -z "${DATABASE_URL:-}" ]      && MISSING="${MISSING} DATABASE_URL"
[ -z "${POSTGRES_USER:-}" ]     && MISSING="${MISSING} POSTGRES_USER"
[ -z "${POSTGRES_PASSWORD:-}" ] && MISSING="${MISSING} POSTGRES_PASSWORD"
[ -z "${POSTGRES_DB:-}" ]       && MISSING="${MISSING} POSTGRES_DB"

if [ -n "${MISSING}" ]; then
  fail "В .env не заполнены обязательные переменные:${MISSING}"
  warn "Откройте .env и задайте значения, затем запустите скрипт снова."
  exit 1
fi
ok ".env найден, обязательные переменные заданы"

# -----------------------------------------------------------------------------
# Шаг 2. Ожидание готовности PostgreSQL
# -----------------------------------------------------------------------------
step "Шаг 2/5. Жду, пока база данных PostgreSQL станет доступна"

# Хост и порт БД: внутри docker-сети это сервис 'postgres:5432'.
# Можно переопределить через PGHOST/PGPORT при запуске вне Docker.
DB_HOST="${PGHOST:-postgres}"
DB_PORT="${PGPORT:-5432}"

# Готовим переменные окружения для psql/pg_isready, чтобы не дублировать
# параметры подключения в каждой команде.
export PGHOST="${DB_HOST}"
export PGPORT="${DB_PORT}"
export PGUSER="${POSTGRES_USER}"
export PGPASSWORD="${POSTGRES_PASSWORD}"
export PGDATABASE="${POSTGRES_DB}"

# Ждём готовности до 60 попыток с паузой 2с (≈2 минуты).
ATTEMPTS=60
until pg_isready -q -h "${DB_HOST}" -p "${DB_PORT}" -U "${POSTGRES_USER}" 2>/dev/null; do
  ATTEMPTS=$((ATTEMPTS - 1))
  if [ "${ATTEMPTS}" -le 0 ]; then
    fail "База данных не ответила за отведённое время."
    warn "Проверьте, что контейнер postgres запущен: docker compose ps"
    exit 1
  fi
  printf "  ... жду базу данных (%s:%s)\n" "${DB_HOST}" "${DB_PORT}"
  sleep 2
done
ok "База данных доступна (${DB_HOST}:${DB_PORT})"

# -----------------------------------------------------------------------------
# Шаг 3. Накат миграций (идемпотентно)
# -----------------------------------------------------------------------------
step "Шаг 3/5. Накатываю миграции из db/migrations"

# Пароли ролей БД (admik_app / admik_migrator) приходят psql-переменными
# (:'APP_PASSWORD' / :'MIGRATOR_PASSWORD') в миграции 0001 (§3.4). Если они не
# заданы в .env — подставляем безопасные значения по умолчанию, чтобы накат не
# падал на необъявленной psql-переменной. Для боевого запуска задайте свои.
APP_PASSWORD="${APP_PASSWORD:-change-me-app-password}"
MIGRATOR_PASSWORD="${MIGRATOR_PASSWORD:-change-me-migrator-password}"

if [ ! -d "${MIGRATIONS_DIR}" ]; then
  warn "Каталог ${MIGRATIONS_DIR} не найден — пропускаю миграции."
else
  # Считаем .sql-файлы. nullglob, чтобы пустой шаблон не дал имя '*.sql'.
  shopt -s nullglob
  MIGRATION_FILES=("${MIGRATIONS_DIR}"/*.sql)
  shopt -u nullglob

  if [ "${#MIGRATION_FILES[@]}" -eq 0 ]; then
    warn "Файлы миграций (*.sql) не найдены — пропускаю."
  else
    # Накатываем по порядку имён (миграции принято нумеровать: 001_, 002_, ...).
    # Миграции должны быть идемпотентны (CREATE ... IF NOT EXISTS),
    # поэтому повторный запуск безопасен.
    for migration in $(printf '%s\n' "${MIGRATION_FILES[@]}" | sort); do
      name="$(basename "${migration}")"
      printf "  → применяю %s\n" "${name}"
      # ON_ERROR_STOP=1 — остановиться при первой ошибке SQL.
      # -v передаёт пароли ролей БД в миграцию 0001 (§3.4); прочие миграции их
      # не используют — лишние переменные psql безвредны.
      if ! psql -v ON_ERROR_STOP=1 \
                -v APP_PASSWORD="${APP_PASSWORD}" \
                -v MIGRATOR_PASSWORD="${MIGRATOR_PASSWORD}" \
                -q -f "${migration}"; then
        fail "Ошибка при применении миграции ${name}."
        exit 1
      fi
    done
    ok "Миграции применены (${#MIGRATION_FILES[@]} шт.)"
  fi
fi

# -----------------------------------------------------------------------------
# Шаг 4. Seed — начальные данные (права, роли, владелец)
# -----------------------------------------------------------------------------
# Все шаги seed идемпотентны (ON CONFLICT DO NOTHING + проверка существования
# владельца), поэтому повторный запуск init-shop безопасен.
step "Шаг 4/5. Заполняю начальные данные (seed)"

SEED_DIR="${PROJECT_ROOT}/db/seed"

if [ ! -d "${SEED_DIR}" ]; then
  warn "Каталог ${SEED_DIR} не найден — пропускаю seed."
else
  # 4.1. Справочники прав и ролей — строгий порядок: сначала permissions
  #      (на них ссылается role_permissions через FK), затем roles.
  for seed_file in permissions.sql roles.sql; do
    seed_path="${SEED_DIR}/${seed_file}"
    if [ ! -f "${seed_path}" ]; then
      warn "Файл seed ${seed_file} не найден — пропускаю."
      continue
    fi
    printf "  → накатываю %s\n" "${seed_file}"
    if ! psql -v ON_ERROR_STOP=1 -q -f "${seed_path}"; then
      fail "Ошибка при накате seed ${seed_file}."
      exit 1
    fi
  done
  ok "Права и системные роли засеяны (идемпотентно)"

  # 4.2. Владелец магазина из .env (OWNER_EMAIL/OWNER_PASSWORD).
  #      owner.mjs идемпотентен: если владелец уже есть — ничего не делает.
  #      Если OWNER_PASSWORD пуст — сгенерирует пароль и напечатает ОДИН РАЗ.
  #      Подключение к БД берётся из экспортированных выше PG* (владелец БД).
  if [ -f "${SEED_DIR}/owner.mjs" ]; then
    printf "  → создаю владельца магазина (db/seed/owner.mjs)\n"
    if ! node "${SEED_DIR}/owner.mjs"; then
      fail "Ошибка при создании владельца магазина."
      exit 1
    fi
    ok "Seed владельца выполнен"
  else
    warn "Файл owner.mjs не найден — владелец не создан."
  fi
fi

# -----------------------------------------------------------------------------
# Шаг 5. ОПЦИОНАЛЬНО — демонстрационный каталог (SEED_DEMO_CATALOG=true)
# -----------------------------------------------------------------------------
# Демо-каталог — это НЕОБЯЗАТЕЛЬНЫЕ примерные данные (нейтральные категории/
# товары/варианты/остатки) для ознакомления и smoke. Боевой магазин их НЕ
# получает: по умолчанию SEED_DEMO_CATALOG не задан / false, и шаг пропускается,
# чтобы не засорять каталог демонстрационным «мусором» (универсальность, ADR-003).
# Накат идемпотентен (ON CONFLICT DO NOTHING) — повторный запуск безопасен.
step "Шаг 5/5. Демо-каталог (опционально, SEED_DEMO_CATALOG)"

DEMO_CATALOG_SQL="${SEED_DIR}/demo-catalog.sql"

# Нормализуем флаг к нижнему регистру (true/1/yes — включают демо).
SEED_DEMO_CATALOG_VALUE="$(printf '%s' "${SEED_DEMO_CATALOG:-}" | tr '[:upper:]' '[:lower:]')"

case "${SEED_DEMO_CATALOG_VALUE}" in
  true|1|yes)
    if [ ! -f "${DEMO_CATALOG_SQL}" ]; then
      warn "SEED_DEMO_CATALOG включён, но файл demo-catalog.sql не найден — пропускаю."
    else
      printf "  → накатываю demo-catalog.sql\n"
      if ! psql -v ON_ERROR_STOP=1 -q -f "${DEMO_CATALOG_SQL}"; then
        fail "Ошибка при накате демо-каталога."
        exit 1
      fi
      ok "Демо-каталог засеян (идемпотентно)"
    fi
    ;;
  *)
    ok "Демо-каталог пропущен (SEED_DEMO_CATALOG не задан/false) — каталог пуст"
    ;;
esac

# -----------------------------------------------------------------------------
# Готово
# -----------------------------------------------------------------------------
printf "\n${GREEN}${BOLD}Готово!${NC} Магазин инициализирован.\n"

# Опционально (RUN_SMOKE=true) — сразу подтвердить готовность smoke-проверкой
# (Этап 6, 6.1). По умолчанию выключено: внутри контейнера app может не быть
# curl, а сетевой доступ к публичному адресу — не всегда; поэтому печатаем
# подсказку. На хосте/в deploy.sh smoke вызывается отдельно.
RUN_SMOKE_VALUE="$(printf '%s' "${RUN_SMOKE:-}" | tr '[:upper:]' '[:lower:]')"
case "${RUN_SMOKE_VALUE}" in
  true|1|yes)
    if [ -x "${SCRIPT_DIR}/smoke.sh" ]; then
      step "Запускаю smoke-проверку готовности (RUN_SMOKE=${RUN_SMOKE})"
      "${SCRIPT_DIR}/smoke.sh"
    else
      warn "RUN_SMOKE включён, но ${SCRIPT_DIR}/smoke.sh не найден/не исполняемый — пропускаю."
    fi
    ;;
  *)
    printf "Проверьте готовность: ${BOLD}make smoke${NC} (или ${BOLD}curl http://localhost:3000/api/health${NC})\n"
    ;;
esac
