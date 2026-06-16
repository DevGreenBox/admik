# =============================================================================
# Admik — многоступенчатый Dockerfile для Next.js 16 (standalone) + pnpm
# =============================================================================
# Этапы: deps (зависимости) -> build (сборка) -> runner (минимальный рантайм).
# Итоговый образ содержит только standalone-вывод Next.js и запускается
# от непривилегированного пользователя.
# =============================================================================

# -----------------------------------------------------------------------------
# Базовый образ с включённым corepack/pnpm
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base
# libc6-compat нужен некоторым нативным зависимостям на alpine
RUN apk add --no-cache libc6-compat
# Включаем pnpm через corepack. ВАЖНО: пин под Node 20 — pnpm 11.x требует
# node:sqlite (Node 22+) и падает на node:20-alpine. 9.15.9 = локальная версия +
# совместима с lockfileVersion '9.0'.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# -----------------------------------------------------------------------------
# Этап deps — установка зависимостей (кешируется отдельно от исходников)
# -----------------------------------------------------------------------------
FROM base AS deps
# Копируем только манифесты, чтобы слой с зависимостями переиспользовался
COPY package.json pnpm-lock.yaml* ./
# frozen-lockfile если лок есть; иначе обычная установка (fallback)
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile; \
    else \
      echo "pnpm-lock.yaml не найден — установка без frozen-lockfile" && \
      pnpm install; \
    fi

# -----------------------------------------------------------------------------
# Этап build — сборка приложения в standalone
# -----------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Admik — headless backend без каталога public/. Создаём пустой, чтобы финальный
# `COPY /app/public ./public` в runner-стадии не падал (public not found).
RUN mkdir -p public
# Отключаем телеметрию Next.js при сборке
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# -----------------------------------------------------------------------------
# Этап runner — финальный минимальный образ
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Инструменты инициализации магазина. init-shop.sh запускается ВНУТРИ этого
# контейнера (docs/09 шаг 4, scripts/deploy.sh, `make init`:
#   docker compose exec -T app /app/scripts/init-shop.sh), поэтому в рантайм-образе
# должны быть:
#   • bash — init-shop.sh/smoke.sh используют bash-возможности (массивы, shopt,
#     BASH_SOURCE), которых нет в дефолтном ash alpine;
#   • postgresql-client — psql/pg_isready: ожидание готовности БД и накат
#     идемпотентных миграций из db/migrations.
# Без них задокументированный шаг инициализации падает (scripts/db в standalone
# не попадают, утилит БД в alpine нет). См. docs/02/09 (copy-paste-развёртывание).
RUN apk add --no-cache bash postgresql-client

# Непривилегированный пользователь для запуска приложения
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Публичные статические файлы
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Standalone-сервер Next.js (включает минимальный node_modules — туда трассируются
# postgres и @node-rs/argon2, нужные db/seed/owner.mjs при инициализации)
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# Статика Next.js (.next/static обслуживается standalone-сервером)
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# Драйвер БД для db/seed/owner.mjs (init-shop). Next standalone НЕ трассирует
# 'postgres' в node_modules надёжно (даже как serverExternalPackages) — копируем
# реальные файлы пакета из pnpm-стора (postgres.js zero-deps). Версия — из лок-файла.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm/postgres@*/node_modules/postgres ./node_modules/postgres
# Скрипты развёртывания и SQL-миграции/seed — НЕ входят в standalone-трассировку
# Next.js, поэтому копируются явно (нужны init-shop.sh внутри контейнера app).
COPY --from=build --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=build --chown=nextjs:nodejs /app/db ./db
# Гарантируем исполняемость скриптов (на случай потери +x при копировании).
RUN chmod +x ./scripts/*.sh

USER nextjs

EXPOSE 3000

# server.js генерируется Next.js в standalone-выводе
CMD ["node", "server.js"]
