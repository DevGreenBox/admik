import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { sizeChartsSchema } from '@/lib/settings/schemas';

/**
 * Тесты сид-данных КОНКРЕТНОГО магазина «THE CASE» — размерные сетки.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ СИДА (docs/02, ADR-003, мультитенантность): цифры и
 * названия из брифа владельца — это КОНТЕНТ магазина, а не дефолт платформы.
 * Платформенная миграция 0035 заводит только ПУСТУЮ строку 'size_charts' → '{}',
 * а реальные значения живут в db/seed/the-case-size-charts.sql и накатываются
 * вручную на конкретный инстанс. Тест ниже сторожит оба инварианта.
 *
 * ИСТОЧНИК ЦИФР — docs/madina-brief-assets/razmernaya_setka.docx. Значения
 * перенесены ДОСЛОВНО. В частности, у строки «42 XS» обхват бёдер = 90 при шаге
 * +4 см у всех прочих строк (104/108/112). Это сверено с исходником и вынесено
 * владельцу на подтверждение; до ответа владельца тест ФИКСИРУЕТ 90, чтобы
 * никто не «поправил» цифру молча.
 */

const root = (rel: string) =>
  fileURLToPath(new URL(`../../${rel}`, import.meta.url));

const SEED_PATH = 'db/seed/the-case-size-charts.sql';
const MIGRATION_PATH = 'db/migrations/0035_shop_settings_size_charts_seed.sql';

const seedSql = readFileSync(root(SEED_PATH), 'utf8');
const migrationSql = readFileSync(root(MIGRATION_PATH), 'utf8');

/** Достаём единственный jsonb-литерал сида: '<json>'::jsonb. */
function extractSeedJson(): unknown {
  const match = seedSql.match(/\$json\$([\s\S]*?)\$json\$/);
  expect(match, 'сид должен содержать полезную нагрузку в dollar-quoted $json$…$json$').not.toBeNull();
  return JSON.parse(match![1]);
}

describe('миграция 0035 — платформенная часть (без данных магазина)', () => {
  it('файл существует и назван по шаблону NNNN_name.sql', () => {
    expect(existsSync(root(MIGRATION_PATH))).toBe(true);
  });

  it("сидирует ключ 'size_charts' ПУСТЫМ объектом", () => {
    expect(migrationSql).toMatch(/\('size_charts',\s*'\{\}'::jsonb\)/);
  });

  it('идемпотентна: ON CONFLICT ... DO NOTHING (не затирает правки владельца)', () => {
    expect(migrationSql).toMatch(/ON\s+CONFLICT\s*\(setting_key\)\s*DO\s+NOTHING/i);
  });

  it('регистрируется в schema_migrations', () => {
    expect(migrationSql).toMatch(
      /INSERT\s+INTO\s+schema_migrations\s*\(version,\s*name\)[\s\S]*'0035'[\s\S]*ON\s+CONFLICT\s+DO\s+NOTHING/i,
    );
  });

  it('НЕ содержит данных THE CASE (мультитенантность: платформа нейтральна)', () => {
    expect(migrationSql).not.toMatch(/84|165-172|180-187|XXL|Обхват/i);
  });
});

describe('db/seed/the-case-size-charts.sql — контент магазина', () => {
  it('файл существует', () => {
    expect(existsSync(root(SEED_PATH))).toBe(true);
  });

  it('не затирает уже отредактированное владельцем значение', () => {
    // Миграция 0035 уже создала строку '{}' → нужен DO UPDATE, но ТОЛЬКО пока
    // значение осталось пустым. Иначе повторный накат сида откатит правки из UI.
    expect(seedSql).toMatch(/ON\s+CONFLICT\s*\(setting_key\)\s*DO\s+UPDATE/i);
    expect(seedSql).toMatch(/WHERE\s+shop_settings\.value\s*=\s*'\{\}'::jsonb/i);
  });

  it('полезная нагрузка проходит платформенную схему sizeChartsSchema', () => {
    const parsed = sizeChartsSchema.safeParse(extractSeedJson());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });
});

describe('данные владельца перенесены дословно', () => {
  const value = sizeChartsSchema.parse(extractSeedJson());
  const women = value.charts.find((c) => c.id === 'women');
  const men = value.charts.find((c) => c.id === 'men');

  it('две сетки: женская и мужская, в этом порядке', () => {
    expect(value.charts.map((c) => c.id)).toEqual(['women', 'men']);
  });

  it('колонки одинаковы у обеих сеток и соответствуют исходнику', () => {
    const expected = [
      { key: 'size', label: 'Размер' },
      { key: 'chest', label: 'Обхват груди, см' },
      { key: 'waist', label: 'Обхват талии, см' },
      { key: 'hips', label: 'Обхват бедер, см' },
    ];
    expect(women!.columns).toEqual(expected);
    expect(men!.columns).toEqual(expected);
  });

  it('рост подписан у каждой сетки', () => {
    expect(women!.note).toBe('рост 165-172');
    expect(men!.note).toBe('рост 180-187');
  });

  it('genders заданы по контракту (нормализация ё→е на витрине)', () => {
    expect(women!.genders).toEqual(['women', 'женский', 'жен', 'ж']);
    expect(men!.genders).toEqual(['men', 'мужской', 'муж', 'м']);
  });

  it('женские строки — ровно как в docx (включая спорные 90 у 42 XS)', () => {
    expect(women!.rows).toEqual([
      { size: '42 XS', chest: '84', waist: '64', hips: '90' },
      { size: '44 S', chest: '88', waist: '68', hips: '104' },
      { size: '46 M', chest: '92', waist: '72', hips: '108' },
      { size: '48 L', chest: '96', waist: '76', hips: '112' },
    ]);
  });

  it('мужские строки — ровно как в docx', () => {
    expect(men!.rows).toEqual([
      { size: '48 M', chest: '96', waist: '84', hips: '100' },
      { size: '50 L', chest: '100', waist: '88', hips: '104' },
      { size: '52 XL', chest: '104', waist: '92', hips: '108' },
      { size: '54 XXL', chest: '108', waist: '96', hips: '112' },
    ]);
  });

  it('сноска про допустимое отклонение ±2 см сохранена', () => {
    expect(value.footnote).toMatch(/±2\s*см/);
  });

  it('спорная ячейка помечена комментарием «сверено с исходником»', () => {
    // Страховка от «тихой правки»: если кто-то поменяет 90 → 100, он обязан
    // снять и комментарий, а тест выше упадёт на самой цифре.
    expect(seedSql).toMatch(/сверено с исходником/i);
  });
});
