import { describe, it, expect } from 'vitest';

import { sizeChartsSchema, SETTING_KEYS, SETTING_SCHEMAS } from '@/lib/settings/schemas';

/**
 * size_charts — размерные сетки как настройка магазина.
 *
 * Ключ настроек хранит ПРОИЗВОЛЬНЫЙ набор сеток с ПРОИЗВОЛЬНЫМИ колонками
 * (не зашитыми в код): каждая сетка описывает columns[] (key/label) и rows[]
 * (плоский словарь columnKey → значение-строка). Это мультитенантный контракт:
 * платформенный дефолт — ПУСТОЙ массив сеток, никаких данных конкретного магазина.
 *
 * Схема — `.strip()` (анти-tamper JSONB, как у остальных ключей настроек) и
 * ограничена по длинам/размерам, чтобы кривой JSONB не разносил витрину.
 */

/** Валидный образец по согласованному контракту (структура, не данные магазина). */
const validValue = {
  charts: [
    {
      id: 'women',
      title: 'Женская размерная сетка',
      note: 'рост 165-172',
      genders: ['women', 'женский', 'жен'],
      columns: [
        { key: 'size', label: 'Размер' },
        { key: 'chest', label: 'Обхват груди, см' },
        { key: 'waist', label: 'Обхват талии, см' },
        { key: 'hips', label: 'Обхват бёдер, см' },
      ],
      rows: [{ size: '42 XS', chest: '84', waist: '64', hips: '90' }],
    },
  ],
  footnote: 'Допустимое отклонение ±2 см.',
};

describe('settings/schemas — sizeChartsSchema', () => {
  it('валидный объект проходит и сохраняет порядок сеток/колонок/строк', () => {
    const parsed = sizeChartsSchema.safeParse(validValue);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.charts).toHaveLength(1);
    expect(parsed.data.charts[0]!.id).toBe('women');
    expect(parsed.data.charts[0]!.genders).toEqual(['women', 'женский', 'жен']);
    expect(parsed.data.charts[0]!.columns.map((c) => c.key)).toEqual([
      'size',
      'chest',
      'waist',
      'hips',
    ]);
    expect(parsed.data.charts[0]!.rows[0]).toEqual({
      size: '42 XS',
      chest: '84',
      waist: '64',
      hips: '90',
    });
    expect(parsed.data.footnote).toBe('Допустимое отклонение ±2 см.');
  });

  it('пустой объект {} даёт дефолт charts: [] (платформенный дефолт — без сеток)', () => {
    const parsed = sizeChartsSchema.safeParse({});

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.charts).toEqual([]);
    expect(parsed.data.footnote).toBeUndefined();
  });

  it('несколько сеток сохраняют порядок; пустой genders (сетка «всегда подходит») валиден', () => {
    const parsed = sizeChartsSchema.safeParse({
      charts: [
        { id: 'a', title: 'A', genders: [], columns: [{ key: 'size', label: 'S' }], rows: [] },
        { id: 'b', title: 'B', columns: [{ key: 'size', label: 'S' }], rows: [] },
      ],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.charts.map((c) => c.id)).toEqual(['a', 'b']);
    // genders не задан → дефолт [] (сетка применима всегда).
    expect(parsed.data.charts[1]!.genders).toEqual([]);
  });

  it('неописанные поля вырезаются (.strip) — анти-tamper JSONB', () => {
    const parsed = sizeChartsSchema.safeParse({
      ...validValue,
      evilTop: 'x',
      charts: [{ ...validValue.charts[0], evilChart: 'x' }],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty('evilTop');
    expect(parsed.data.charts[0]).not.toHaveProperty('evilChart');
  });

  it('строка вместо массива rows отвергается', () => {
    const bad = {
      charts: [{ ...validValue.charts[0], rows: 'размер 42' }],
    };

    expect(sizeChartsSchema.safeParse(bad).success).toBe(false);
  });

  it('строка вместо массива charts отвергается', () => {
    expect(sizeChartsSchema.safeParse({ charts: 'women' }).success).toBe(false);
  });

  it('дубли id в массиве charts отвергаются', () => {
    const bad = {
      charts: [
        { id: 'women', title: 'A', columns: [{ key: 'size', label: 'S' }], rows: [] },
        { id: 'women', title: 'B', columns: [{ key: 'size', label: 'S' }], rows: [] },
      ],
    };

    expect(sizeChartsSchema.safeParse(bad).success).toBe(false);
  });

  it('слишком длинные значения отвергаются (id, title, footnote, значение ячейки)', () => {
    const base = validValue.charts[0]!;

    expect(
      sizeChartsSchema.safeParse({ charts: [{ ...base, id: 'x'.repeat(200) }] }).success,
    ).toBe(false);
    expect(
      sizeChartsSchema.safeParse({ charts: [{ ...base, title: 'x'.repeat(500) }] }).success,
    ).toBe(false);
    expect(
      sizeChartsSchema.safeParse({ ...validValue, footnote: 'x'.repeat(2000) }).success,
    ).toBe(false);
    expect(
      sizeChartsSchema.safeParse({
        charts: [{ ...base, rows: [{ size: 'x'.repeat(500) }] }],
      }).success,
    ).toBe(false);
  });

  it('пустые обязательные строки (id/title/label) отвергаются', () => {
    const base = validValue.charts[0]!;

    expect(sizeChartsSchema.safeParse({ charts: [{ ...base, id: '  ' }] }).success).toBe(false);
    expect(sizeChartsSchema.safeParse({ charts: [{ ...base, title: '' }] }).success).toBe(false);
    expect(
      sizeChartsSchema.safeParse({ charts: [{ ...base, columns: [{ key: 'size', label: '' }] }] })
        .success,
    ).toBe(false);
  });

  it('сетка без колонок отвергается (таблицу нечем рисовать)', () => {
    const base = validValue.charts[0]!;
    expect(sizeChartsSchema.safeParse({ charts: [{ ...base, columns: [] }] }).success).toBe(false);
  });

  it("ключ 'size_charts' зарегистрирован в реестре ключ → схема", () => {
    expect(SETTING_KEYS).toContain('size_charts');
    expect(SETTING_SCHEMAS.size_charts).toBe(sizeChartsSchema);
  });
});

/**
 * Границы объёма значения (security-review спринта A, находка №1).
 *
 * z.record сам по себе НЕ ограничивает КОЛИЧЕСТВО ключей в строке, поэтому лимиты
 * `charts ≤ 24` / `rows ≤ 200` создавали лишь иллюзию границы: строка могла нести
 * сотни ячеек без колонок. Замер на этой же схеме показал, что принимается ~260 МБ.
 *
 * Почему это важно именно здесь:
 *   - витрина отдаёт настройки БЕЗ кеша, на каждый рендер страницы (force-dynamic);
 *   - лишние ключи никогда не рендерятся (таблица идёт по columns) — раздувание невидимо;
 *   - audit_log пишет before/after целиком, без усечения.
 */
describe('settings/schemas — sizeChartsSchema: границы объёма и целостность строк', () => {
  const chart = (over: Record<string, unknown> = {}) => ({
    charts: [{ ...validValue.charts[0], ...over }],
  });

  it('строка с числом ячеек больше числа допустимых колонок отвергается (анти-амплификация)', () => {
    const fatRow: Record<string, string> = {};
    for (let i = 0; i < 300; i += 1) fatRow[`k${i}`] = 'x';

    const parsed = sizeChartsSchema.safeParse(chart({ rows: [fatRow] }));
    expect(parsed.success).toBe(false);
  });

  it('ключ ячейки, которому не соответствует ни одна колонка, отвергается', () => {
    const parsed = sizeChartsSchema.safeParse(
      chart({ rows: [{ size: '42 XS', chest: '84', ghost: 'нет такой колонки' }] }),
    );
    expect(parsed.success).toBe(false);
  });

  it('строка вправе не содержать часть колонок (пустая ячейка просто отсутствует)', () => {
    const parsed = sizeChartsSchema.safeParse(chart({ rows: [{ size: '42 XS' }] }));
    expect(parsed.success).toBe(true);
  });

  it('дубли column.key внутри одной сетки отвергаются', () => {
    const parsed = sizeChartsSchema.safeParse(
      chart({
        columns: [
          { key: 'size', label: 'Размер' },
          { key: 'size', label: 'Размер ещё раз' },
        ],
        rows: [{ size: '42 XS' }],
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it('одинаковые column.key в РАЗНЫХ сетках допустимы (уникальность — в пределах сетки)', () => {
    const parsed = sizeChartsSchema.safeParse({
      charts: [
        validValue.charts[0],
        { ...validValue.charts[0], id: 'men', title: 'Мужская размерная сетка' },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
