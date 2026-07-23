import { describe, it, expect } from 'vitest';

import { resolveLegalEntity, legalEntityLine } from './legal-entity';
import type { AdmikSettingsDto } from './admik';

/**
 * Реквизиты продавца в подвале (правка владельца 2026-07-22, п.1 — «добавить
 * данные ИП, и в принципе где нужно по закону»).
 *
 * Требование закона (ст. 9 ФЗ «О защите прав потребителей», п. 2 Правил продажи
 * при дистанционном способе): продавец обязан сообщить покупателю наименование,
 * ОГРН(ИП) и адрес. Поэтому строка собирается ТОЛЬКО из реально заполненных
 * полей — выдумывать или подставлять заглушки нельзя.
 */
function dto(legalEntity?: Partial<AdmikSettingsDto['legalEntity']>): AdmikSettingsDto {
  return { legalEntity } as unknown as AdmikSettingsDto;
}

describe('resolveLegalEntity', () => {
  it('настройки не пришли → пусто (ничего не выдумываем)', () => {
    const r = resolveLegalEntity(null);
    expect(r.name).toBeNull();
    expect(r.inn).toBeNull();
    expect(legalEntityLine(r)).toBeNull();
  });

  it('все поля null (реквизиты не заполнены) → строки нет', () => {
    const r = resolveLegalEntity(
      dto({ name: null, inn: null, kpp: null, ogrn: null, legalAddress: null }),
    );
    expect(legalEntityLine(r)).toBeNull();
  });

  it('пробельные значения трактуются как незаполненные', () => {
    const r = resolveLegalEntity(dto({ name: '   ', inn: '' }));
    expect(r.name).toBeNull();
    expect(legalEntityLine(r)).toBeNull();
  });

  it('собирает строку из заполненных полей с подписями', () => {
    const r = resolveLegalEntity(
      dto({
        name: 'ИП Иванов Иван Иванович',
        inn: '860101234567',
        ogrn: '304860136600054',
        legalAddress: 'г. Сургут, ул. Юности, 8',
      }),
    );
    const line = legalEntityLine(r);
    expect(line).toBe(
      'ИП Иванов Иван Иванович · ИНН 860101234567 · ОГРНИП 304860136600054 · г. Сургут, ул. Юности, 8',
    );
  });

  it('частично заполненные реквизиты → показываем что есть, без пустых разделителей', () => {
    const r = resolveLegalEntity(dto({ name: 'ИП Иванов И.И.', inn: '860101234567' }));
    expect(legalEntityLine(r)).toBe('ИП Иванов И.И. · ИНН 860101234567');
  });

  it('ОГРН из 13 цифр (юрлицо) подписывается «ОГРН», 15 (ИП) — «ОГРНИП»', () => {
    const company = resolveLegalEntity(dto({ ogrn: '1027700132195' }));
    expect(legalEntityLine(company)).toBe('ОГРН 1027700132195');

    const ip = resolveLegalEntity(dto({ ogrn: '304860136600054' }));
    expect(legalEntityLine(ip)).toBe('ОГРНИП 304860136600054');
  });

  it('КПП показывается только когда задан (у ИП его нет)', () => {
    const r = resolveLegalEntity(dto({ name: 'ООО «Кейс»', inn: '7701234567', kpp: '770101001' }));
    expect(legalEntityLine(r)).toBe('ООО «Кейс» · ИНН 7701234567 · КПП 770101001');
  });
});
