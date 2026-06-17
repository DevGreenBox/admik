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
# Этап sharp — чистая установка sharp под ЦЕЛЕВУЮ платформу (musl/x64)
# -----------------------------------------------------------------------------
# Зачем отдельная стадия: standalone-трассировка Next.js (nft) НЕ тянет нативный
# libvips (@img/sharp-libvips-linuxmusl-x64), который sharp грузит через dlopen —
# в итоге обработка изображений в рантайме падает (ERR_DLOPEN libvips-cpp.so.*),
# и весь модуль lib/storage/image (а с ним экшены каталога) не загружается.
# Чистый `npm install` под платформу кладёт совместимые @img/* с нужной ABI libvips.
# Версию берём из package.json приложения (синхронно, без хардкода).
FROM node:20-alpine AS sharp
WORKDIR /sharp
COPY package.json /tmp/app-package.json
RUN SHARP_VER=$(node -p "require('/tmp/app-package.json').dependencies.sharp") \
 && npm init -y >/dev/null 2>&1 \
 && npm install --no-audit --no-fund --include=optional \
      --os=linux --libc=musl --cpu=x64 "sharp@${SHARP_VER}" \
 # Вкладываем ВСЕ зависимости sharp (@img/color/detect-libc/semver и их транзитив)
 # внутрь sharp/node_modules — так пакет sharp становится САМОДОСТАТОЧНЫМ: в рантайме
 # копируем только node_modules/sharp, его require'ы резолвятся из вложенного
 # node_modules, не завися от верхнего уровня (где pnpm-симлинки) и не требуя NODE_PATH.
 && cd /sharp/node_modules \
 && mkdir -p sharp/node_modules \
 && for d in *; do case "$d" in sharp|.*) ;; *) mv "$d" sharp/node_modules/ ;; esac; done

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
# sharp + нативный libvips: standalone-трассировка Next.js приносит pnpm-копию sharp
# с НЕсовместимым libvips (8.17.3 от 0.34.5 вместо 8.18.3 от 0.35.1) и без @img на
# верхнем уровне → ERR_DLOPEN при обработке изображений, из-за чего весь модуль
# lib/storage/image (и экшены каталога) не загружается.
# Решение: удаляем сломанную pnpm-копию sharp из standalone и кладём на её место
# САМОДОСТАТОЧНЫЙ sharp из стадии `sharp` (зависимости вложены в sharp/node_modules).
# Turbopack грузит sharp как external через ESM import('sharp'), а import НЕ смотрит
# в NODE_PATH — поэтому пакет должен лежать именно в /app/node_modules/sharp
# (реальный каталог, не pnpm-симлинк), с вложенными @img/color/etc. внутри.
# serverExternalPackages:['sharp'] (next.config) держит sharp вне бандла.
RUN rm -rf ./node_modules/sharp ./node_modules/.pnpm/sharp@* ./node_modules/.pnpm/@img+*
COPY --from=sharp --chown=nextjs:nodejs /sharp/node_modules/sharp ./node_modules/sharp
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
