import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRateLimiter,
  MemoryRateBackend,
  RATE_LIMIT,
} from '@/lib/auth/rate-limit';

describe('auth/rate-limit (mock / in-memory)', () => {
  let limiter: ReturnType<typeof createRateLimiter>;

  beforeEach(() => {
    // Каждому тесту — свежий in-memory бэкенд, чтобы состояние не протекало.
    limiter = createRateLimiter({ backend: new MemoryRateBackend() });
  });

  it('по умолчанию запрос разрешён', async () => {
    const res = await limiter.checkLoginRate('login:fail:1.2.3.4');
    expect(res.allowed).toBe(true);
    expect(res.retryAfterSec).toBeUndefined();
  });

  it('блокирует после достижения порога неудач', async () => {
    const key = 'login:fail:1.2.3.4';
    for (let i = 0; i < RATE_LIMIT.maxAttempts; i++) {
      await limiter.registerLoginFailure(key);
    }
    const res = await limiter.checkLoginRate(key);
    expect(res.allowed).toBe(false);
    expect(res.retryAfterSec).toBeGreaterThan(0);
    expect(res.retryAfterSec).toBeLessThanOrEqual(RATE_LIMIT.windowSec);
  });

  it('ниже порога остаётся разрешённым', async () => {
    const key = 'login:fail:5.6.7.8';
    for (let i = 0; i < RATE_LIMIT.maxAttempts - 1; i++) {
      await limiter.registerLoginFailure(key);
    }
    const res = await limiter.checkLoginRate(key);
    expect(res.allowed).toBe(true);
  });

  it('resetLoginFailures снимает блокировку', async () => {
    const key = 'login:fail:1.2.3.4';
    for (let i = 0; i < RATE_LIMIT.maxAttempts; i++) {
      await limiter.registerLoginFailure(key);
    }
    expect((await limiter.checkLoginRate(key)).allowed).toBe(false);

    await limiter.resetLoginFailures(key);
    expect((await limiter.checkLoginRate(key)).allowed).toBe(true);
  });

  it('разные ключи независимы', async () => {
    const a = 'login:fail:a@example.com';
    const b = 'login:fail:b@example.com';
    for (let i = 0; i < RATE_LIMIT.maxAttempts; i++) {
      await limiter.registerLoginFailure(a);
    }
    expect((await limiter.checkLoginRate(a)).allowed).toBe(false);
    expect((await limiter.checkLoginRate(b)).allowed).toBe(true);
  });

  it('истёкшее окно сбрасывает счётчик', async () => {
    const backend = new MemoryRateBackend();
    const lim = createRateLimiter({ backend, windowSec: 1 });
    const key = 'login:fail:expiry';
    for (let i = 0; i < RATE_LIMIT.maxAttempts; i++) {
      await lim.registerLoginFailure(key);
    }
    expect((await lim.checkLoginRate(key)).allowed).toBe(false);

    // Принудительно состариваем запись в обход реального времени.
    backend.__advance(2_000);
    expect((await lim.checkLoginRate(key)).allowed).toBe(true);
  });
});
