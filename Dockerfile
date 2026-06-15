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
# Включаем pnpm через corepack (входит в Node 20)
RUN corepack enable && corepack prepare pnpm@latest --activate
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

# Непривилегированный пользователь для запуска приложения
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Публичные статические файлы
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Standalone-сервер Next.js (включает минимальный node_modules)
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# Статика Next.js (.next/static обслуживается standalone-сервером)
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# server.js генерируется Next.js в standalone-выводе
CMD ["node", "server.js"]
