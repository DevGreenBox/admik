import { describe, expect, it } from 'vitest';

import { normalizeClientIp } from '@/lib/server/request-ip';

// =============================================================================
// ЮНИТ-тесты нормализации клиентского IP (lib/server/request-ip.ts).
//
// КОНТЕКСТ БАГА (major, reliability):
//   Раньше IP брался из X-Forwarded-For ДОСЛОВНО: `forwarded.split(',')[0].trim()`.
//   Этот сырой строковый IP шёл в колонку `inet` (sessions.ip / audit_log.ip).
//   Кривой/подделанный заголовок ('not-an-ip', мусор) → Postgres падает на касте
//   к inet → INSERT сессии падает → ЛОГИН СЛОМАН. Подделать X-Forwarded-For
//   тривиально, но и обычный битый прокси-заголовок ломает вход.
//
// ФИКС: normalizeClientIp валидирует кандидата через node:net isIP() ДО любого
//   inet-INSERT. Невалидный → undefined (не доверяем мусору). Это чистая
//   dependency-free функция → тестируется ВСЕГДА, без next/headers и БД.
// =============================================================================

describe('normalizeClientIp — валидация IP перед записью в колонку inet', () => {
  it('мусорный X-Forwarded-For ("garbage") → undefined (не "garbage")', () => {
    expect(normalizeClientIp('garbage', null)).toBeUndefined();
  });

  it('мусор в первом сегменте списка → undefined (не доверяем подделке)', () => {
    expect(normalizeClientIp('not-an-ip, 10.0.0.1', null)).toBeUndefined();
  });

  it('валидный IPv4 в списке "203.0.113.7, 10.0.0.1" → "203.0.113.7" (первый)', () => {
    expect(normalizeClientIp('203.0.113.7, 10.0.0.1', null)).toBe('203.0.113.7');
  });

  it('одиночный валидный IPv4 без списка → как есть', () => {
    expect(normalizeClientIp('198.51.100.4', null)).toBe('198.51.100.4');
  });

  it('валидный IPv6 → как есть', () => {
    expect(
      normalizeClientIp('2001:db8::8a2e:370:7334', null),
    ).toBe('2001:db8::8a2e:370:7334');
  });

  it('пустой/отсутствующий X-Forwarded-For → undefined', () => {
    expect(normalizeClientIp(null, null)).toBeUndefined();
    expect(normalizeClientIp('', null)).toBeUndefined();
    expect(normalizeClientIp(undefined, undefined)).toBeUndefined();
  });

  it('строка из одних пробелов → undefined', () => {
    expect(normalizeClientIp('   ', null)).toBeUndefined();
  });

  it('тримит пробелы вокруг валидного IP', () => {
    expect(normalizeClientIp('  203.0.113.7  ', null)).toBe('203.0.113.7');
  });

  it('XFF пуст/невалиден → fallback на валидный x-real-ip', () => {
    expect(normalizeClientIp(null, '192.0.2.55')).toBe('192.0.2.55');
    expect(normalizeClientIp('garbage', '192.0.2.55')).toBe('192.0.2.55');
    expect(normalizeClientIp('', ' 192.0.2.55 ')).toBe('192.0.2.55');
  });

  it('невалидный x-real-ip тоже отбрасывается → undefined', () => {
    expect(normalizeClientIp(null, 'still-not-an-ip')).toBeUndefined();
  });

  // ===========================================================================
  // SECURITY (аудит 2026-07-18, HIGH): X-Real-IP (за Caddy перезаписан реальным
  // IP пира) — ДОВЕРЕННЫЙ источник и имеет ПРИОРИТЕТ над клиент-контролируемым
  // leftmost X-Forwarded-For. Иначе ротацией XFF атакующий обходит rate-limit
  // публичных POST (DoS склада) и отравляет orders.ip/audit_log.ip.
  // ===========================================================================
  it('X-Real-IP (доверенный, за Caddy) имеет приоритет над X-Forwarded-For', () => {
    // XFF подделан клиентом, X-Real-IP проставлен прокси → берём X-Real-IP.
    expect(normalizeClientIp('203.0.113.7', '192.0.2.55')).toBe('192.0.2.55');
  });

  it('спуфнутый leftmost XFF игнорируется при валидном X-Real-IP', () => {
    // Классическая атака: свежий случайный XFF на каждый запрос ради нового
    // ведра rate-limit. За Caddy X-Real-IP стабилен и реален → лимит работает.
    expect(normalizeClientIp('1.2.3.4', '198.51.100.9')).toBe('198.51.100.9');
    expect(normalizeClientIp('5.6.7.8', '198.51.100.9')).toBe('198.51.100.9');
  });

  it('X-Real-IP невалиден → fallback на leftmost XFF (окружение без прокси)', () => {
    expect(normalizeClientIp('203.0.113.7', 'garbage')).toBe('203.0.113.7');
    expect(normalizeClientIp('203.0.113.7', null)).toBe('203.0.113.7');
  });
});
