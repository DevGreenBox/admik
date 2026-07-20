import { describe, it, expect } from 'vitest';
import { getEnv } from '@/lib/config/env';

describe('config/env', () => {
  it('подставляет NODE_ENV=development по умолчанию', () => {
    const env = getEnv({});
    expect(env.NODE_ENV).toBe('development');
  });

  it('читает корректные значения', () => {
    const env = getEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/admik',
      SHOP_NAME: 'Тестовый магазин',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.DATABASE_URL).toBe(
      'postgres://user:pass@localhost:5432/admik',
    );
    expect(env.SHOP_NAME).toBe('Тестовый магазин');
  });

  it('бросает понятную ошибку при некорректном URL', () => {
    expect(() => getEnv({ DATABASE_URL: 'не-url' })).toThrowError(
      /конфигурация окружения/i,
    );
  });

  it('бросает ошибку при недопустимом NODE_ENV', () => {
    expect(() => getEnv({ NODE_ENV: 'staging' })).toThrow();
  });

  it('допускает отсутствие опциональных переменных', () => {
    const env = getEnv({ NODE_ENV: 'test' });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.S3_BUCKET).toBeUndefined();
  });

  // SECURITY (аудит 2026-07-18, #15): в PRODUCTION наши секреты — минимум 16 символов.
  it('секреты (#15): короткий ORDER_TOKEN_SECRET в production отклоняется', () => {
    expect(() =>
      getEnv({ NODE_ENV: 'production', ORDER_TOKEN_SECRET: 'short' }),
    ).toThrow(/ORDER_TOKEN_SECRET/);
  });
  it('секреты (#15): короткий CDEK_WEBHOOK_SECRET / CDEK_CRON_SECRET в production отклоняются', () => {
    expect(() =>
      getEnv({ NODE_ENV: 'production', CDEK_WEBHOOK_SECRET: 'x' }),
    ).toThrow(/CDEK_WEBHOOK_SECRET/);
    expect(() =>
      getEnv({ NODE_ENV: 'production', CDEK_CRON_SECRET: 'x' }),
    ).toThrow(/CDEK_CRON_SECRET/);
  });
  it('секреты (#15): вне production короткий секрет НЕ ломает (dev/CI-фикстуры)', () => {
    expect(getEnv({ NODE_ENV: 'test', CDEK_CRON_SECRET: 'short' }).CDEK_CRON_SECRET).toBe('short');
  });
  it('секреты (#15): секрет ≥16 символов в production принимается; отсутствие — тоже', () => {
    const env = getEnv({ NODE_ENV: 'production', ORDER_TOKEN_SECRET: 'a'.repeat(16) });
    expect(env.ORDER_TOKEN_SECRET).toBe('a'.repeat(16));
    expect(getEnv({ NODE_ENV: 'production' }).ORDER_TOKEN_SECRET).toBeUndefined();
  });

  // SECURITY (#2): opt-in демо-оплаты в проде.
  it('TBANK_ALLOW_MOCK (#2): дефолт false; "true" → true', () => {
    expect(getEnv({ NODE_ENV: 'test' }).TBANK_ALLOW_MOCK).toBe(false);
    expect(getEnv({ NODE_ENV: 'test', TBANK_ALLOW_MOCK: 'true' }).TBANK_ALLOW_MOCK).toBe(true);
  });

  it('заказы: дефолты порога доставки (0) и префикса номера (пусто)', () => {
    const env = getEnv({ NODE_ENV: 'test' });
    expect(env.SHOP_FREE_DELIVERY_THRESHOLD).toBe(0);
    expect(env.SHOP_ORDER_PREFIX).toBe('');
    // SHOP_CURRENCY уже существует — дефолт сохранён.
    expect(env.SHOP_CURRENCY).toBe('RUB');
  });

  it('заказы: SHOP_FREE_DELIVERY_THRESHOLD приводится из строки env (coerce)', () => {
    const env = getEnv({ SHOP_FREE_DELIVERY_THRESHOLD: '3000', SHOP_ORDER_PREFIX: 'GA' });
    expect(env.SHOP_FREE_DELIVERY_THRESHOLD).toBe(3000);
    expect(env.SHOP_ORDER_PREFIX).toBe('GA');
  });

  it('заказы: отрицательный порог доставки отклоняется', () => {
    expect(() => getEnv({ SHOP_FREE_DELIVERY_THRESHOLD: '-100' })).toThrow();
  });
});
