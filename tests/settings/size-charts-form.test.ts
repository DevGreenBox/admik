import { describe, it, expect } from 'vitest';

import {
  buildSizeChartsPayload,
  chartsToFormState,
  emptyChartDraft,
  emptyColumnDraft,
  parseGendersText,
  type SizeChartsFormState,
} from '@/lib/settings/size-charts-form';
import { sizeChartsSchema, type SizeChartsSettings } from '@/lib/settings/schemas';

/**
 * UI-форма «Размерные сетки» (settings/size-charts).
 *
 * Компонентного рендера нет (vitest environment=node, без RTL) — покрываем
 * чистую логику: состояние формы → значение настройки size_charts, и обратно
 * (эффективные настройки → состояние формы). Инвариант: всё, что собирает
 * форма из осмысленного ввода, обязано проходить sizeChartsSchema.
 */

const state: SizeChartsFormState = {
  charts: [
    {
      id: 'women',
      title: 'Женская размерная сетка',
      note: 'рост 165-172',
      gendersText: 'women, женский, жен',
      columns: [
        { key: 'size', label: 'Размер' },
        { key: 'chest', label: 'Обхват груди, см' },
      ],
      rows: [
        ['42 XS', '84'],
        ['44 S', '88'],
      ],
    },
  ],
  footnote: 'Допустимое отклонение ±2 см.',
};

describe('settings/size-charts-form — buildSizeChartsPayload (чистая сборка)', () => {
  it('состояние формы → значение по контракту, и оно проходит sizeChartsSchema', () => {
    const value = buildSizeChartsPayload(state);

    expect(value).toEqual({
      charts: [
        {
          id: 'women',
          title: 'Женская размерная сетка',
          note: 'рост 165-172',
          genders: ['women', 'женский', 'жен'],
          columns: [
            { key: 'size', label: 'Размер' },
            { key: 'chest', label: 'Обхват груди, см' },
          ],
          rows: [
            { size: '42 XS', chest: '84' },
            { size: '44 S', chest: '88' },
          ],
        },
      ],
      footnote: 'Допустимое отклонение ±2 см.',
    });
    expect(sizeChartsSchema.safeParse(value).success).toBe(true);
  });

  it('порядок сеток, колонок и строк сохраняется как в форме', () => {
    const two: SizeChartsFormState = {
      charts: [
        { ...state.charts[0]!, id: 'b', title: 'Б' },
        { ...state.charts[0]!, id: 'a', title: 'А' },
      ],
      footnote: '',
    };
    const value = buildSizeChartsPayload(two);
    expect(value.charts.map((c) => c.id)).toEqual(['b', 'a']);
    expect(value.charts[0]!.rows.map((r) => r['size'])).toEqual(['42 XS', '44 S']);
  });

  it('пустые note/footnote ОТСУТСТВУЮТ в значении (а не null/пустая строка)', () => {
    const value = buildSizeChartsPayload({
      charts: [{ ...state.charts[0]!, note: '   ' }],
      footnote: '  ',
    });
    expect('footnote' in value).toBe(false);
    expect('note' in value.charts[0]!).toBe(false);
    expect(sizeChartsSchema.safeParse(value).success).toBe(true);
  });

  it('пустой список полов → genders: [] («сетка применима всегда»)', () => {
    const value = buildSizeChartsPayload({
      charts: [{ ...state.charts[0]!, gendersText: '  ,  , ' }],
      footnote: '',
    });
    expect(value.charts[0]!.genders).toEqual([]);
    expect(sizeChartsSchema.safeParse(value).success).toBe(true);
  });

  it('строка, где все ячейки пустые, отбрасывается; частично заполненная — остаётся без пустых ячеек', () => {
    const value = buildSizeChartsPayload({
      charts: [{ ...state.charts[0]!, rows: [['', '  '], ['46 M', '']] }],
      footnote: '',
    });
    expect(value.charts[0]!.rows).toEqual([{ size: '46 M' }]);
  });

  it('колонки без key и label отбрасываются целиком, ячейки под ними не попадают в строки', () => {
    const value = buildSizeChartsPayload({
      charts: [
        {
          ...state.charts[0]!,
          columns: [{ key: 'size', label: 'Размер' }, { key: '  ', label: '  ' }],
          rows: [['42 XS', 'мусор']],
        },
      ],
      footnote: '',
    });
    expect(value.charts[0]!.columns).toEqual([{ key: 'size', label: 'Размер' }]);
    expect(value.charts[0]!.rows).toEqual([{ size: '42 XS' }]);
  });

  it('значения тримятся; пустые сетки (без id и title) отбрасываются', () => {
    const value = buildSizeChartsPayload({
      charts: [
        { ...state.charts[0]!, id: '  women  ', title: '  Ж  ' },
        { ...emptyChartDraft(''), id: '  ', title: '  ' },
      ],
      footnote: '',
    });
    expect(value.charts).toHaveLength(1);
    expect(value.charts[0]!.id).toBe('women');
    expect(value.charts[0]!.title).toBe('Ж');
  });

  it('дубли id формой не «чинятся» — значение отвергает sizeChartsSchema (ошибка покажется в форме)', () => {
    const value = buildSizeChartsPayload({
      charts: [state.charts[0]!, { ...state.charts[0]! }],
      footnote: '',
    });
    expect(value.charts).toHaveLength(2);
    expect(sizeChartsSchema.safeParse(value).success).toBe(false);
  });

  it('пустая форма → { charts: [] } (платформенный дефолт, без данных магазина)', () => {
    const value = buildSizeChartsPayload({ charts: [], footnote: '' });
    expect(value).toEqual({ charts: [] });
    expect(sizeChartsSchema.safeParse(value).success).toBe(true);
  });
});

describe('settings/size-charts-form — chartsToFormState (значение → форма)', () => {
  it('round-trip: значение → состояние формы → то же значение', () => {
    const value = buildSizeChartsPayload(state);
    const back = buildSizeChartsPayload(chartsToFormState(value as SizeChartsSettings));
    expect(back).toEqual(value);
  });

  it('ячейка отсутствующей в строке колонки становится пустой строкой в форме', () => {
    const form = chartsToFormState({
      charts: [
        {
          id: 'w',
          title: 'Ж',
          genders: [],
          columns: [
            { key: 'size', label: 'Размер' },
            { key: 'chest', label: 'Грудь' },
          ],
          rows: [{ size: '42' }],
        },
      ],
    } as SizeChartsSettings);
    expect(form.charts[0]!.rows).toEqual([['42', '']]);
    expect(form.charts[0]!.note).toBe('');
    expect(form.footnote).toBe('');
    expect(form.charts[0]!.gendersText).toBe('');
  });
});

describe('settings/size-charts-form — вспомогательные', () => {
  it('parseGendersText режет по запятым/переводам строк, тримит и убирает пустые', () => {
    expect(parseGendersText(' women , \n женский,, ')).toEqual(['women', 'женский']);
  });

  it('emptyChartDraft даёт черновик с одной колонкой и без строк', () => {
    const draft = emptyChartDraft('chart-2');
    expect(draft.id).toBe('chart-2');
    expect(draft.columns).toHaveLength(1);
    expect(draft.rows).toEqual([]);
  });

  it('emptyColumnDraft даёт пустую колонку (key/label заполняет владелец)', () => {
    expect(emptyColumnDraft()).toEqual({ key: '', label: '' });
  });
});
