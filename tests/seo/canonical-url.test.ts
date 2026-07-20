import { describe, it, expect } from 'vitest';

import { canonicalUrlSchema } from '@/lib/seo/schemas';

/**
 * Тесты пакета 5.S-1 (docs/11 §5.3.6) — Zod-валидация canonical_url.
 *
 * Защита от open-redirect/XSS в <link rel=canonical>: принимается ТОЛЬКО
 * абсолютный https-URL ИЛИ path с ведущим '/'. Мусор (javascript:, относительный
 * без '/', http без host, пробелы) → validation на уровне схемы (не доходит до
 * рендера). Схема переиспользуется в ProductUpdate/CategoryUpdate/BrandUpdate.
 */

describe('seo/schemas — canonicalUrlSchema (валидное)', () => {
  it('абсолютный https принимается', () => {
    const r = canonicalUrlSchema.safeParse('https://shop.example/p/x');
    expect(r.success).toBe(true);
  });

  it('относительный путь с ведущим / принимается', () => {
    const r = canonicalUrlSchema.safeParse('/catalog/sneakers');
    expect(r.success).toBe(true);
  });

  it('пустая строка/undefined допустимы (поле необязательно)', () => {
    expect(canonicalUrlSchema.safeParse(undefined).success).toBe(true);
  });
});

describe('seo/schemas — canonicalUrlSchema (отклоняемый мусор)', () => {
  it('javascript: → validation', () => {
    expect(canonicalUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });

  it('относительный путь без ведущего / → validation', () => {
    expect(canonicalUrlSchema.safeParse('catalog/x').success).toBe(false);
  });

  it('http:// (не https) → validation', () => {
    expect(canonicalUrlSchema.safeParse('http://shop.example/x').success).toBe(false);
  });

  it('строка с пробелом → validation', () => {
    expect(canonicalUrlSchema.safeParse('/path with space').success).toBe(false);
  });

  it('абсолютный без host (https://) → validation', () => {
    expect(canonicalUrlSchema.safeParse('https://').success).toBe(false);
  });

  it('protocol-relative //evil.com → validation (не path с одиночным /)', () => {
    expect(canonicalUrlSchema.safeParse('//evil.com/x').success).toBe(false);
  });
});

/**
 * SECURITY (аудит 2026-07-18, доработка находки #11). canonicalUrlSchema — ОТДЕЛЬНАЯ
 * от lib/security/safe-href.ts проверка с другой политикой (canonical допускает
 * ТОЛЬКО https, не mailto/tel/якоря), поэтому она намеренно НЕ сведена к общему
 * модулю. Но обход через обратный слэш у неё был тот же: условие
 * `startsWith('/') && !startsWith('//')` истинно для '/\evil.com', а WHATWG URL
 * резолвит его в 'https://evil.com/' — то есть <link rel=canonical> уводил бы
 * поисковики на чужой домен.
 */
describe('seo/schemas — canonicalUrlSchema и обратный слэш (находка #11)', () => {
  it.each(['/\\evil.com', '/\\\\evil.com', '\\\\evil.com', '/path\\..\\evil'])(
    'отвергает %j',
    (v) => {
      expect(canonicalUrlSchema.safeParse(v).success).toBe(false);
    },
  );

  it('обычный путь и https по-прежнему принимаются', () => {
    expect(canonicalUrlSchema.safeParse('/catalog/x').success).toBe(true);
    expect(canonicalUrlSchema.safeParse('https://shop.example/x').success).toBe(true);
  });
});
