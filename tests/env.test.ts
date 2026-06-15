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
});
