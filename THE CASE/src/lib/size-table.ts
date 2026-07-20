/**
 * Размерные сетки товара — выбор подходящих сеток по полу. Чистая функция
 * (без React) → тестируется юнит-тестами (size-table.test.ts).
 *
 * Источник данных — настройки магазина Admik (ключ `size_charts`, публичное поле
 * DTO `sizeCharts`). Колонки таблицы ПРОИЗВОЛЬНЫ и приходят из настройки: витрина
 * не знает заранее «Размер/Грудь/Талия/Бёдра», поэтому один и тот же компонент
 * годится и для медформы, и для обуви, и для любого будущего магазина
 * (мультитенантность — ноль хардкода под конкретный ассортимент).
 *
 * Фолбэк «показать ВСЕ сетки, если ни одна не подошла» — осознанное исправление
 * бага прежней реализации (`gender === "men" ? men : women`), из-за которого
 * unisex/неизвестный пол МОЛЧА получал женскую таблицу. Когда пол неизвестен,
 * честнее показать все сетки, чем угадать одну.
 */

/** Колонка таблицы: `key` адресует поле в строке, `label` — заголовок столбца. */
export interface SizeChartColumn {
  key: string;
  label: string;
}

export interface SizeChart {
  /** Slug, уникален в пределах массива сеток. */
  id: string;
  title: string;
  /** Подпись под заголовком (например «рост 165-172»). */
  note?: string;
  /** Значения `product.gender`, к которым применима сетка. Пустой массив = всегда. */
  genders: string[];
  columns: SizeChartColumn[];
  /** Строки таблицы: значения по ключам колонок. */
  rows: Record<string, string>[];
}

/** Значение настройки `size_charts` целиком. */
export interface SizeChartsSettings {
  charts: SizeChart[];
  /** Общая сноска под таблицей. */
  footnote?: string;
}

/** trim + lowercase + ё→е: пол приходит произвольной строкой из атрибутов товара. */
function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/ё/g, 'е');
}

/**
 * Сетки, подходящие товару с указанным полом.
 *
 * 1) нет сеток → [];
 * 2) сетка с пустым `genders` подходит всегда;
 * 3) иначе — если нормализованный `gender` есть в нормализованном `genders`;
 * 4) не подошла ни одна (unisex, пусто, мусор) → ВСЕ сетки.
 *
 * Порядок сеток сохраняется как в настройке.
 */
export function selectSizeCharts(
  charts: SizeChart[] | null | undefined,
  gender: string | null | undefined,
): SizeChart[] {
  const all = charts ?? [];
  if (all.length === 0) return [];

  const target = normalize(gender);
  const matched = all.filter((chart) => {
    const genders = chart.genders ?? [];
    if (genders.length === 0) return true;
    if (target.length === 0) return false;
    return genders.some((g) => normalize(g) === target);
  });

  return matched.length > 0 ? matched : [...all];
}

/** Что показываем на месте незаполненной ячейки. */
const EMPTY_CELL = '—';

/**
 * Значение ячейки строки по ключу колонки.
 *
 * Читаем ТОЛЬКО own-свойства: ключи колонок задаёт контент-менеджер, а строка —
 * обычный объект, поэтому прямой `row[key]` для «toString»/«constructor»/«valueOf»
 * вернул бы функцию из Object.prototype. Оператор `??` её не отсекает (она
 * непустая), и React отрисовал бы пустую ячейку с руганью в консоли.
 *
 * Пустая строка — это законное значение (ячейка есть, но пустая), прочерк ставим
 * только когда ячейки нет вовсе.
 */
export function getCell(row: Record<string, string>, key: string): string {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return EMPTY_CELL;
  const value = row[key];
  return typeof value === 'string' ? value : EMPTY_CELL;
}
