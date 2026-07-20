import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * SECURITY (аудит 2026-07-18, #17): fail-closed выбора бэкенда rate-limit.
 *
 * Rate-limit/lockout — контроль безопасности (брутфорс логина, абуз публичных
 * ручек витрины). In-memory бэкенд не делится между инстансами и обнуляется при
 * рестарте → в production это ТИХАЯ деградация защиты. Поэтому в production без
 * REDIS_URL модуль обязан бросать, а не молча стартовать на памяти.
 *
 * Ключевой урок находки: гвард стоял ТОЛЬКО в getDefaultLimiter(), тогда как
 * весь боевой трафик витрины (18 публичных ручек → runStorefront →
 * checkStorefrontRate) шёл через ДВОЙНИКА getStorefrontLimiter() без гварда.
 * Поэтому здесь проверяются ОБЕ точки входа — admin-путь (checkLoginRate) и
 * storefront-путь (checkStorefrontRate/registerStorefrontHit).
 */

// ioredis мокаем: в CI живого Redis нет, а нам важен лишь ФАКТ выбора
// Redis-бэкенда (что гвард не сработал и лимитер построился).
vi.mock('ioredis', () => {
  class FakeRedis {
    constructor(
      public readonly url: string,
      public readonly opts?: unknown,
    ) {}
    async get(): Promise<string | null> {
      return null;
    }
    async ttl(): Promise<number> {
      return -2;
    }
    async incr(): Promise<number> {
      return 1;
    }
    async expire(): Promise<number> {
      return 1;
    }
    async del(): Promise<number> {
      return 1;
    }
  }
  return { default: FakeRedis };
});

/**
 * Заново загружает модуль конфигурации и rate-limit под заданным окружением.
 * Кеши (env + ленивые лимитеры) сбрасываются, иначе значения протекают между
 * кейсами. NODE_ENV правим через vi.stubEnv — прямое присваивание запрещено
 * типами Node (readonly) и не откатывается автоматически.
 */
async function loadWithEnv(env: {
  NODE_ENV: string;
  REDIS_URL?: string;
}): Promise<typeof import('@/lib/auth/rate-limit')> {
  vi.stubEnv('NODE_ENV', env.NODE_ENV);
  vi.stubEnv('REDIS_URL', env.REDIS_URL);

  const { resetEnvCache } = await import('@/lib/config/env');
  resetEnvCache();
  const mod = await import('@/lib/auth/rate-limit');
  mod.resetDefaultLimiter();
  return mod;
}

/** Сценарии: обе фабрики должны вести себя ОДИНАКОВО (двойников быть не должно). */
const ENTRY_POINTS: ReadonlyArray<{
  name: string;
  check: (
    mod: typeof import('@/lib/auth/rate-limit'),
    key: string,
  ) => Promise<unknown>;
  register: (
    mod: typeof import('@/lib/auth/rate-limit'),
    key: string,
  ) => Promise<unknown>;
}> = [
  {
    name: 'admin/login (getDefaultLimiter)',
    check: (mod, key) => mod.checkLoginRate(key),
    register: (mod, key) => mod.registerLoginFailure(key),
  },
  {
    name: 'storefront (getStorefrontLimiter)',
    check: (mod, key) => mod.checkStorefrontRate(key),
    register: (mod, key) => mod.registerStorefrontHit(key),
  },
];

describe('auth/rate-limit — fail-closed выбора бэкенда (#17)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    const { resetEnvCache } = await import('@/lib/config/env');
    resetEnvCache();
    const mod = await import('@/lib/auth/rate-limit');
    mod.resetDefaultLimiter();
    vi.restoreAllMocks();
  });

  for (const entry of ENTRY_POINTS) {
    describe(entry.name, () => {
      it('production без REDIS_URL → бросает (не стартует молча на памяти)', async () => {
        const mod = await loadWithEnv({ NODE_ENV: 'production' });
        await expect(entry.check(mod, 'k:1.2.3.4')).rejects.toThrow(/REDIS_URL/);
      });

      it('production без REDIS_URL → ошибка объясняет причину И починку', async () => {
        const mod = await loadWithEnv({ NODE_ENV: 'production' });
        const err = await entry
          .register(mod, 'k:1.2.3.4')
          .then(() => null)
          .catch((e: unknown) => e as Error);
        expect(err).toBeInstanceOf(Error);
        const message = (err as Error).message;
        // Причина: почему память недопустима в production.
        expect(message).toMatch(/памят/i);
        expect(message).toMatch(/рестарт/i);
        // Починка: что именно сделать администратору.
        expect(message).toMatch(/REDIS_URL/);
        expect(message).toMatch(/Redis/);
      });

      it('production С REDIS_URL → работает (Redis-бэкенд, без броска)', async () => {
        const mod = await loadWithEnv({
          NODE_ENV: 'production',
          REDIS_URL: 'redis://127.0.0.1:6379',
        });
        await expect(entry.check(mod, 'k:1.2.3.4')).resolves.toMatchObject({
          allowed: true,
        });
        await expect(entry.register(mod, 'k:1.2.3.4')).resolves.toBeUndefined();
      });

      it('не-production без REDIS_URL → память + warn, без броска', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const mod = await loadWithEnv({ NODE_ENV: 'development' });
        await expect(entry.check(mod, 'k:1.2.3.4')).resolves.toMatchObject({
          allowed: true,
        });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toMatch(/mock-режим/i);
        // warn — одноразовый, не спамит на каждый запрос.
        await entry.check(mod, 'k:5.6.7.8');
        expect(warn).toHaveBeenCalledTimes(1);
      });
    });
  }

  it('гвард один на обе фабрики: сообщение об ошибке идентично', async () => {
    const mod = await loadWithEnv({ NODE_ENV: 'production' });
    const admin = await mod
      .checkLoginRate('k:1')
      .then(() => null)
      .catch((e: Error) => e.message);
    const storefront = await mod
      .checkStorefrontRate('k:1')
      .then(() => null)
      .catch((e: Error) => e.message);
    expect(admin).toBeTruthy();
    expect(storefront).toBe(admin);
  });
});
