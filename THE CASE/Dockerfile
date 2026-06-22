# =============================================================================
# THE CASE (витрина) — многоступенчатый Dockerfile для Next.js 15 (standalone) + npm
# =============================================================================
# Этапы: deps (зависимости) -> build (сборка) -> runner (минимальный рантайм).
# Витрина — headless-потребитель публичного API Admik. Итоговый образ содержит
# только standalone-вывод Next.js и запускается от непривилегированного пользователя.
# =============================================================================

# -----------------------------------------------------------------------------
# Базовый образ
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base
# libc6-compat нужен некоторым нативным зависимостям на alpine (sharp и др.)
RUN apk add --no-cache libc6-compat
WORKDIR /app

# -----------------------------------------------------------------------------
# Этап deps — установка зависимостей (кешируется отдельно от исходников)
# -----------------------------------------------------------------------------
FROM base AS deps
# Копируем только манифесты, чтобы слой с зависимостями переиспользовался
COPY package.json package-lock.json ./
# Строгая установка по локу (детерминированная сборка)
RUN npm ci

# -----------------------------------------------------------------------------
# Этап build — сборка приложения в standalone
# -----------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Отключаем телеметрию Next.js при сборке
ENV NEXT_TELEMETRY_DISABLED=1
# Публичный адрес API Admik вшивается в клиентский бандл НА ЭТАПЕ СБОРКИ
# (NEXT_PUBLIC_* инлайнится в client-код), поэтому задаётся как build-arg.
ARG NEXT_PUBLIC_ADMIK_API_URL
ENV NEXT_PUBLIC_ADMIK_API_URL=$NEXT_PUBLIC_ADMIK_API_URL
RUN npm run build

# -----------------------------------------------------------------------------
# Этап runner — финальный минимальный образ
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Непривилегированный пользователь для запуска приложения
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Публичные статические файлы
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Standalone-сервер Next.js (включает server.js в корне + минимальный node_modules)
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# Статика Next.js (.next/static обслуживается standalone-сервером)
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# server.js генерируется Next.js в standalone-выводе
CMD ["node", "server.js"]
