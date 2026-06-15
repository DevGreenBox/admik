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

  // Заказы (Этап 3, docs/07 §3.3, §8 пакет F) — без хардкодов магазина:
  // Порог бесплатной доставки. Если (items_total − discount_total) ≥ порога →
  // delivery_total = 0. По умолчанию 0 = выключено (для Gang Auto = 3000).
  // coerce — из строки env.
  SHOP_FREE_DELIVERY_THRESHOLD: z.coerce.number().min(0).default(0),
  // Префикс человекочитаемого номера заказа (docs/07 §2.7): `ПРЕФИКС-ГОД-NNNNNN`.
  // По умолчанию пусто (номер вида `2026-000123`); для магазина задаётся в env.
  SHOP_ORDER_PREFIX: z.string().default(''),

  // ---------------------------------------------------------------------------
  // СДЭК (Этап 4, docs/08 §13.2). ВСЕ переменные опциональны: при пустых
  // CDEK_ACCOUNT/CDEK_SECRET модуль работает в MOCK-режиме (см. lib/cdek/config.ts
  // isCdekMock). Это позволяет demo-магазину и CI работать без боевых ключей.
  // ---------------------------------------------------------------------------
  // Базовый URL API. Prod: https://api.cdek.ru, test-контур: https://api.edu.cdek.ru.
  CDEK_BASE_URL: z.string().url().default('https://api.cdek.ru'),
  // client_id / client_secret. ПУСТО → mock-режим.
  CDEK_ACCOUNT: z.string().optional(),
  CDEK_SECRET: z.string().optional(),
  // Тестовый контур СДЭК. coerce: 'true'/'1'/'false'/'0' из строки env → boolean.
  CDEK_TEST_MODE: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Код города отправления (дефолт 44 = Москва). Взаимоисключим с CDEK_SHIPMENT_POINT.
  CDEK_FROM_LOCATION_CODE: z.coerce.number().int().min(0).default(44),
  // Код склада отправителя (если задан — используется вместо from_location).
  CDEK_SHIPMENT_POINT: z.string().optional(),
  // Тариф по умолчанию (дефолт 136).
  CDEK_DEFAULT_TARIFF: z.coerce.number().int().min(0).default(136),
  // Белый список тарифов (csv); пусто = разрешены все. Парсится в config.ts.
  CDEK_ALLOWED_TARIFFS: z.string().optional(),
  // Отправитель (для buildPayload, пакет D).
  CDEK_SENDER_NAME: z.string().optional(),
  CDEK_SENDER_CONTACT_NAME: z.string().optional(),
  CDEK_SENDER_PHONE: z.string().optional(),
  CDEK_SENDER_EMAIL: z.string().optional(),
  CDEK_SENDER_INN: z.string().optional(),
  // Дефолтные габариты упаковки (аналог cdek-dimensions.php */* fallback).
  CDEK_DEFAULT_WEIGHT_G: z.coerce.number().int().min(0).default(500),
  CDEK_DEFAULT_LENGTH_CM: z.coerce.number().int().min(0).default(30),
  CDEK_DEFAULT_WIDTH_CM: z.coerce.number().int().min(0).default(20),
  CDEK_DEFAULT_HEIGHT_CM: z.coerce.number().int().min(0).default(10),
  // Секрет ?key= для webhook (пакет F).
  CDEK_WEBHOOK_SECRET: z.string().optional(),
  // IP/CIDR whitelist webhook (csv); пусто допустимо лишь в test-режиме.
  CDEK_WEBHOOK_IPS: z.string().optional(),
  // Доверять прокси-заголовку IP (за Caddy).
  CDEK_WEBHOOK_TRUST_PROXY: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Секрет cron-роутов (пакет G).
  CDEK_CRON_SECRET: z.string().optional(),
  // Kill-switch авто-создания отправлений (дефолт true).
  CDEK_CREATE_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
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
