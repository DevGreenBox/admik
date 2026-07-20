import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { extractWebhookIp } from '@/lib/server/request-ip';

/**
 * SECURITY (аудит 2026-07-18, находки #1/#3 — ЗАРЯЖЕННАЯ МИНА).
 *
 * Роуты вебхуков СДЭК и Т-Банка имели СВОЮ копию `extractIp` с ПРОТИВОПОЛОЖНЫМ
 * приоритетом относительно `normalizeClientIp`: сначала leftmost X-Forwarded-For,
 * X-Real-IP — лишь fallback. Leftmost XFF ПОЛНОСТЬЮ подконтролен клиенту (Caddy
 * дописывает реальный IP СПРАВА), а X-Real-IP Caddy ПЕРЕЗАПИСЫВАЕТ реальным IP
 * пира (`header_up X-Real-IP {http.request.remote.host}`).
 *
 * Последствие при *_WEBHOOK_TRUST_PROXY=true (JSDoc роутов уже обещает, что за
 * Caddy IP доверенный):
 *   • IP-whitelist обходится заголовком `X-Forwarded-For: <IP из whitelist>`;
 *   • у СДЭК тот же IP пишется в `cdek_status_log.ip` → отравление аудита (#3).
 *
 * Фикс: ОДНА общая функция `extractWebhookIp` в lib/server/request-ip.ts, поверх
 * `normalizeClientIp` — приоритет источников задаётся в ЕДИНСТВЕННОМ месте.
 * Контракт вебхуков сохранён: флаг `trustProxy` и '' (не undefined) при отказе.
 */

const VALID_WHITELISTED = '203.0.113.10';
const ATTACKER_REAL = '198.51.100.7';

describe('extractWebhookIp — приоритет источников (защита от спуфинга)', () => {
  it('АТАКА: спуфнутый leftmost XFF НЕ побеждает заданный X-Real-IP', () => {
    // Атакующий шлёт XFF с IP из whitelist; Caddy проставляет его РЕАЛЬНЫЙ IP
    // в X-Real-IP. Довериться обязаны только X-Real-IP.
    const headers = new Headers({
      'x-forwarded-for': VALID_WHITELISTED,
      'x-real-ip': ATTACKER_REAL,
    });
    expect(extractWebhookIp(headers, true)).toBe(ATTACKER_REAL);
  });

  it('АТАКА: цепочка XFF (спуфнутый leftmost + дописанный прокси) не побеждает X-Real-IP', () => {
    const headers = new Headers({
      'x-forwarded-for': `${VALID_WHITELISTED}, 10.0.0.1`,
      'x-real-ip': ATTACKER_REAL,
    });
    expect(extractWebhookIp(headers, true)).toBe(ATTACKER_REAL);
  });

  it('X-Real-IP отсутствует → fallback на leftmost XFF (окружение без нашего прокси)', () => {
    const headers = new Headers({ 'x-forwarded-for': `${VALID_WHITELISTED}, 10.0.0.1` });
    expect(extractWebhookIp(headers, true)).toBe(VALID_WHITELISTED);
  });

  it('невалидный X-Real-IP → fallback на валидный XFF', () => {
    const headers = new Headers({
      'x-forwarded-for': VALID_WHITELISTED,
      'x-real-ip': 'garbage',
    });
    expect(extractWebhookIp(headers, true)).toBe(VALID_WHITELISTED);
  });

  it('мусор в обоих заголовках → \'\' (в whitelist/аудит мусор не попадёт)', () => {
    const headers = new Headers({ 'x-forwarded-for': 'garbage', 'x-real-ip': 'nonsense' });
    expect(extractWebhookIp(headers, true)).toBe('');
  });

  it('заголовков нет → \'\'', () => {
    expect(extractWebhookIp(new Headers(), true)).toBe('');
  });

  it('IPv6 в X-Real-IP принимается', () => {
    const headers = new Headers({ 'x-real-ip': '2001:db8::1' });
    expect(extractWebhookIp(headers, true)).toBe('2001:db8::1');
  });
});

describe('extractWebhookIp — контракт trustProxy=false', () => {
  it('trustProxy=false → \'\' даже при валидных заголовках (whitelist не аутентифицирует)', () => {
    const headers = new Headers({
      'x-forwarded-for': VALID_WHITELISTED,
      'x-real-ip': VALID_WHITELISTED,
    });
    expect(extractWebhookIp(headers, false)).toBe('');
  });

  it('возвращает именно пустую строку (не undefined) — контракт whitelist-слоя', () => {
    const result = extractWebhookIp(new Headers(), false);
    expect(result).toBe('');
    expect(typeof result).toBe('string');
  });
});

/**
 * РЕГРЕСС-СТРАЖ двойников (главный урок проекта: защиту ставят в одну функцию,
 * а боевой трафик идёт через её КОПИЮ с другим поведением). Если кто-то снова
 * заведёт локальный extractIp в роуте вебхука — тест упадёт.
 */
describe('в роутах вебхуков не осталось локальных копий extractIp', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const ROUTES = [
    'app/api/cdek/webhook/route.ts',
    'app/api/payments/tbank/webhook/route.ts',
  ];

  for (const rel of ROUTES) {
    it(`${rel} не объявляет свою функцию извлечения IP и зовёт общую`, () => {
      const src = readFileSync(path.join(ROOT, rel), 'utf8');
      expect(src).not.toMatch(/function\s+extractIp\s*\(/);
      expect(src).toContain('extractWebhookIp');
      // Заголовки читаются только внутри общей функции.
      expect(src).not.toMatch(/headers\.get\(['"]x-forwarded-for['"]\)/);
      expect(src).not.toMatch(/headers\.get\(['"]x-real-ip['"]\)/);
    });
  }
});
