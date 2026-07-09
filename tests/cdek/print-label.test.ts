import { describe, it, expect } from 'vitest';

import {
  MOCK_LABEL_NOTICE,
  labelProxyUrl,
  resolvePrintClick,
} from '@/lib/cdek/print-label';

/**
 * Чистая логика кнопок печати в UI (гэп №3 боевого аудита 2026-07-09).
 *
 * Раньше UI открывал ПРЯМОЙ URL СДЭК (api.cdek.ru/...pdf) — он требует
 * Bearer-токен и живёт ~1 час, браузер получал 401. Теперь печать идёт через
 * авторизованный серверный прокси /admin/cdek/label (скачивает PDF с токеном и
 * отдаёт файл админу). В mock-режиме — прежнее пояснение без открытия вкладки
 * (находка #12).
 */
describe('labelProxyUrl (адрес серверного PDF-прокси)', () => {
  it('строит same-origin путь с orderId и kind (без api.cdek.ru)', () => {
    const url = labelProxyUrl('11111111-1111-4111-8111-111111111111', 'waybill');
    expect(url).toBe(
      '/admin/cdek/label?orderId=11111111-1111-4111-8111-111111111111&kind=waybill',
    );
    expect(url).not.toContain('cdek.ru');
  });

  it('kind=barcode попадает в query', () => {
    expect(labelProxyUrl('ord-1', 'barcode')).toContain('kind=barcode');
  });

  it('orderId экранируется (URL-инъекция невозможна)', () => {
    const url = labelProxyUrl('a&b=c', 'waybill');
    expect(url).toContain('orderId=a%26b%3Dc');
  });
});

describe('resolvePrintClick (исход клика по кнопке печати)', () => {
  it('mock → не открывать, показать пояснение про боевой режим', () => {
    const out = resolvePrintClick('Печать накладной', {
      isMock: true,
      orderId: 'ord-1',
      kind: 'waybill',
    });
    expect(out.open).toBe(false);
    expect(out.url).toBeNull();
    expect(out.message).toContain(MOCK_LABEL_NOTICE);
  });

  it('боевой режим → открыть ПРОКСИ-URL (не прямой линк СДЭК)', () => {
    const out = resolvePrintClick('Печать ШК', {
      isMock: false,
      orderId: 'ord-2',
      kind: 'barcode',
    });
    expect(out.open).toBe(true);
    expect(out.url).toBe(labelProxyUrl('ord-2', 'barcode'));
    expect(out.url).not.toContain('cdek.ru');
  });
});
