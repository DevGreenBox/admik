import { z } from 'zod';

/**
 * Типобезопасное чтение переменных окружения через Zod.
 *
 * На этапе 0 в коде ещё нет обращений к БД/S3/Redis, поэтому большинство
 * переменных опциональны — это позволяет запускать скаффолд и проходить
 * проверки без полной конфигурации. По мере появления модулей переменные
 * будут становиться обязательными.
 */

const envSchema = z.object({
  // Окружение Node.
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // Подключение к БД (обязательно появится на этапе работы с данными).
  DATABASE_URL: z.string().url().optional(),

  // Кеш / rate-limit.
  REDIS_URL: z.string().url().optional(),

  // S3-совместимое хранилище медиа.
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_PUBLIC_URL: z.string().url().optional(),

  // Набор включённых модулей (csv). Парсится в modules.ts.
  ADMIK_MODULES: z.string().optional(),

  // Брендинг магазина.
  SHOP_NAME: z.string().optional(),
  SHOP_LOGO_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Возвращает провалидированную конфигурацию окружения.
 * Бросает понятную ошибку, если значения некорректны.
 */
export function getEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  if (cached && source === process.env) {
    return cached;
  }

  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Некорректная конфигурация окружения (.env):\n${issues}\n` +
        'Проверьте файл .env (см. .env.example).',
    );
  }

  if (source === process.env) {
    cached = parsed.data;
  }

  return parsed.data;
}

/**
 * Сбрасывает кеш конфигурации. Используется в тестах.
 */
export function resetEnvCache(): void {
  cached = undefined;
}
