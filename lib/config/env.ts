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

  // Seed владельца магазина (docs/04 §4.2). Используются init-shop при первом
  // развёртывании: создаётся учётка владельца (is_owner). Если OWNER_PASSWORD
  // не задан — owner.mjs генерирует случайный пароль и печатает его один раз.
  OWNER_EMAIL: z.string().email().optional(),
  OWNER_PASSWORD: z.string().optional(),

  // Пароли ролей БД (ADR-002/ADR-006, §3.4). Передаются в psql при накате
  // миграций (admik_app — рантайм, admik_migrator — DDL). В репозитории нет.
  APP_PASSWORD: z.string().optional(),
  MIGRATOR_PASSWORD: z.string().optional(),

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

  // Каталог: валюта магазина (docs/06 §3.5) — форматирование цен в слое
  // представления/Storefront API; в данных каталога цены без символа валюты.
  SHOP_CURRENCY: z.string().min(1).default('RUB'),
  // Порог «новизны» товара в днях (docs/06 §3.2): если products.is_new IS NULL,
  // товар «новый», пока created_at в пределах SHOP_NEW_PRODUCT_DAYS. coerce — из строки env.
  SHOP_NEW_PRODUCT_DAYS: z.coerce.number().int().min(0).default(30),
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
