import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Юнит-тесты адаптера расчёта стоимости доставки (docs/08 §5, пакет E).
 *
 * Адаптер lib/orders/delivery-cost разводит orders↔cdek: чистый выбор провайдера
 * (stub vs cdek) + расчёт. Сети/БД нет — cdek-провайдер работает в mock-режиме
 * (isCdekMock при пустых CDEK_*). Проверяем:
 *   • модуль cdek выключен → провайдер 0 (stub), поведение Этапа 3 сохранено;
 *   • pickup → 0 даже при включённом cdek;
 *   • cdek включён + назначение → mock-расчёт (детерминирован, source cdek_mock);
 *   • выбор провайдера (pickStubProvider/needsCdek — чистая часть).
 */

const ORIGINAL_MODULES = process.env.ADMIK_MODULES;
const ORIGINAL_ACCOUNT = process.env.CDEK_ACCOUNT;
const ORIGINAL_SECRET = process.env.CDEK_SECRET;

async function load() {
  vi.resetModules();
  return import('@/lib/orders/delivery-cost');
}

describe('orders/delivery-cost — адаптер расчёта доставки', () => {
  beforeEach(() => {
    // mock-режим СДЭК: боевых ключей нет (расчёт по формуле, без сети).
    delete process.env.CDEK_ACCOUNT;
    delete process.env.CDEK_SECRET;
  });
  afterEach(() => {
    process.env.ADMIK_MODULES = ORIGINAL_MODULES;
    if (ORIGINAL_ACCOUNT === undefined) delete process.env.CDEK_ACCOUNT;
    else process.env.CDEK_ACCOUNT = ORIGINAL_ACCOUNT;
    if (ORIGINAL_SECRET === undefined) delete process.env.CDEK_SECRET;
    else process.env.CDEK_SECRET = ORIGINAL_SECRET;
    vi.resetModules();
  });

  it('pickup → 0.00 (source stub) даже при включённом cdek', async () => {
    process.env.ADMIK_MODULES = 'orders,cdek';
    const { computeDeliveryCost } = await load();
    const res = await computeDeliveryCost({
      deliveryType: 'pickup',
      lines: [{ qty: 1 }],
      destination: { cityCode: 44 },
    });
    expect(res.cost).toBe('0.00');
    expect(res.source).toBe('stub');
  });

  it('модуль cdek выключен → провайдер 0 (stub), как Этап 3', async () => {
    process.env.ADMIK_MODULES = 'orders';
    const { computeDeliveryCost } = await load();
    const res = await computeDeliveryCost({
      deliveryType: 'courier',
      lines: [{ qty: 1 }],
      destination: { cityCode: 44 },
    });
    expect(res.cost).toBe('0.00');
    expect(res.source).toBe('stub');
    expect(res.tariffCode).toBeNull();
  });

  it('cdek выключен и без destination → 0.00 stub', async () => {
    process.env.ADMIK_MODULES = 'orders';
    const { computeDeliveryCost } = await load();
    const res = await computeDeliveryCost({
      deliveryType: 'pvz',
      lines: [{ qty: 2 }],
      destination: {},
    });
    expect(res.cost).toBe('0.00');
    expect(res.source).toBe('stub');
  });

  it('cdek включён + назначение → mock-расчёт (детерминирован, > 0)', async () => {
    process.env.ADMIK_MODULES = 'orders,cdek';
    const { computeDeliveryCost } = await load();
    const a = await computeDeliveryCost({
      deliveryType: 'courier',
      lines: [{ qty: 1, weightG: 500 }],
      destination: { cityCode: 44 },
    });
    const b = await computeDeliveryCost({
      deliveryType: 'courier',
      lines: [{ qty: 1, weightG: 500 }],
      destination: { cityCode: 44 },
    });
    expect(a.source).toBe('cdek_mock');
    expect(Number(a.cost)).toBeGreaterThan(0);
    expect(a.cost).toBe(b.cost); // детерминизм mock-формулы
    expect(a.periodMin).toBeGreaterThan(0);
  });

  it('cdek включён, но без назначения → 0.00 stub (нечего считать)', async () => {
    process.env.ADMIK_MODULES = 'orders,cdek';
    const { computeDeliveryCost } = await load();
    const res = await computeDeliveryCost({
      deliveryType: 'courier',
      lines: [{ qty: 1 }],
      destination: {},
    });
    expect(res.cost).toBe('0.00');
    expect(res.source).toBe('stub');
  });

  it('needsCdekProvider — чистый выбор провайдера', async () => {
    const { needsCdekProvider } = await load();
    // pickup никогда не считаем
    expect(
      needsCdekProvider({ cdekEnabled: true, deliveryType: 'pickup', hasDestination: true }),
    ).toBe(false);
    // cdek выключен
    expect(
      needsCdekProvider({ cdekEnabled: false, deliveryType: 'courier', hasDestination: true }),
    ).toBe(false);
    // нет назначения
    expect(
      needsCdekProvider({ cdekEnabled: true, deliveryType: 'courier', hasDestination: false }),
    ).toBe(false);
    // всё на месте → cdek
    expect(
      needsCdekProvider({ cdekEnabled: true, deliveryType: 'courier', hasDestination: true }),
    ).toBe(true);
    expect(
      needsCdekProvider({ cdekEnabled: true, deliveryType: 'pvz', hasDestination: true }),
    ).toBe(true);
  });
});
