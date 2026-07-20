import { describe, it, expect } from 'vitest';
import { TbankManager } from '@/lib/payments/tbank/manager';
import { getTbankConfig } from '@/lib/payments/tbank/config';
import { TbankError } from '@/lib/payments/tbank/errors';

/**
 * Юнит-тесты фасада TbankManager (docs/15 §2.1). Конфиг подаём напрямую (не из
 * process.env), чтобы тест был детерминирован и не мутировал окружение.
 */

const MOCK_CFG = getTbankConfig({ NODE_ENV: 'test' });
const REAL_CFG = getTbankConfig({
  NODE_ENV: 'test',
  TBANK_TERMINAL_KEY: 'tk',
  TBANK_PASSWORD: 'pw',
});

describe('tbank/manager — выбор mock vs real', () => {
  it('пустые ключи → isMock=true, mock-слой доступен', () => {
    const m = new TbankManager({ config: MOCK_CFG });
    expect(m.isMock).toBe(true);
    expect(typeof m.mock.mockInitPayment).toBe('function');
  });

  it('обращение к client в mock-режиме кидает TbankError (баг вызывающего)', () => {
    const m = new TbankManager({ config: MOCK_CFG });
    expect(() => m.client).toThrow(TbankError);
  });

  it('боевые ключи → isMock=false, client инстанцируется (ленивый синглтон)', () => {
    const m = new TbankManager({ config: REAL_CFG, fetchImpl: (async () => new Response('{}')) as typeof fetch });
    expect(m.isMock).toBe(false);
    const c1 = m.client;
    const c2 = m.client;
    expect(c1).toBe(c2); // один и тот же синглтон
    expect(typeof c1.call).toBe('function');
  });
});

/**
 * FAIL-CLOSED В PRODUCTION (аудит 2026-07-18, находка #2, HIGH).
 *
 * Mock-режим означает, что Init не ходит в банк (service.ts, mockInitPayment),
 * а confirmMockPayment доводит заказ до `paid`. Молчаливая деградация в mock из-за
 * потерянного TBANK_PASSWORD = бесплатные «оплаченные» заказы на боевом магазине.
 *
 * ПОЧЕМУ ПРОВЕРКА ЖИВЁТ ЗДЕСЬ, А НЕ ТОЛЬКО В isTbankMock():
 * боевой путь оплаты спрашивает manager.isMock, а НЕ isTbankMock() — они были
 * объявлены эквивалентными в комментариях, но фактически разошлись. Защита,
 * поставленная только в isTbankMock(), на боевом пути не срабатывает вообще.
 * Поэтому решение едет в конфиге (mockAllowed) и проверяется тем геттером,
 * которым реально пользуется сервис.
 */
describe('tbank/manager — mock в production запрещён (fail-closed)', () => {
  const prodNoKeys = () => getTbankConfig({ NODE_ENV: 'production' });

  it('production без боевых ключей → обращение к isMock БРОСАЕТ', () => {
    const m = new TbankManager({ config: prodNoKeys() });
    expect(() => m.isMock).toThrow(/mock/i);
  });

  it('сообщение объясняет причину и способ починки (его прочтёт админ на проде)', () => {
    const m = new TbankManager({ config: prodNoKeys() });
    expect(() => m.isMock).toThrow(/TBANK_TERMINAL_KEY|TBANK_PASSWORD/);
    expect(() => m.isMock).toThrow(/TBANK_ALLOW_MOCK/);
  });

  it('production + явный TBANK_ALLOW_MOCK=true → демо разрешено, isMock=true', () => {
    const cfg = getTbankConfig({ NODE_ENV: 'production', TBANK_ALLOW_MOCK: 'true' });
    const m = new TbankManager({ config: cfg });
    expect(m.isMock).toBe(true);
  });

  it('production + боевые ключи → isMock=false, ничего не бросает', () => {
    const cfg = getTbankConfig({
      NODE_ENV: 'production',
      TBANK_TERMINAL_KEY: 'tk',
      TBANK_PASSWORD: 'pw',
    });
    const m = new TbankManager({ config: cfg });
    expect(m.isMock).toBe(false);
  });

  it('вне production пустые ключи по-прежнему дают mock без ошибки (dev/CI)', () => {
    expect(new TbankManager({ config: getTbankConfig({ NODE_ENV: 'test' }) }).isMock).toBe(true);
    expect(new TbankManager({ config: getTbankConfig({ NODE_ENV: 'development' }) }).isMock).toBe(
      true,
    );
  });

  it('задан только TERMINAL_KEY без PASSWORD — это тоже mock, в проде бросает', () => {
    const cfg = getTbankConfig({ NODE_ENV: 'production', TBANK_TERMINAL_KEY: 'tk' });
    expect(() => new TbankManager({ config: cfg }).isMock).toThrow();
  });
});
