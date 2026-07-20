/**
 * Матрица «цвет × размер» карточки товара — ЧИСТАЯ логика выбора варианта.
 *
 * Зачем отдельный модуль: в витрине нет инфраструктуры тестов компонентов
 * (vitest environment "node", include = src/**\/*.test.ts), поэтому вся логика
 * выбора живёт здесь и покрывается юнит-тестами (variant-matrix.test.ts), а
 * ProductDetailClient остаётся тонким слоем разметки. Тот же приём, что в
 * product-cta.ts и variant-availability.ts.
 *
 * Контракт данных (спринт B): цвет варианта приезжает в `color`/`colorHex`
 * (вариантный EAV на бэкенде), РАЗМЕР остаётся меткой варианта (`size`, из
 * v.name — «42 / XS»). Здесь эти две оси сшиваются обратно в матрицу.
 *
 * Мультитенантность: никаких зашитых названий цветов/размеров — работаем с тем,
 * что пришло из справочника магазина.
 */

import { normalizeColorName } from "@/lib/color-swatch";

/** Минимум полей варианта, нужный матрице (StorefrontVariant ему соответствует). */
export interface MatrixVariant {
  id: string;
  /** Метка размера («M», «42 / XS»). */
  size: string;
  /** Значение цвета варианта («Белый»); null/пусто — цвет не заведён. */
  color?: string | null;
  /** «#RRGGBB» из справочника Admik, если задан. */
  colorHex?: string | null;
  inStock: boolean;
  availableQty: number;
}

/** Цвет как опция выбора на карточке. */
export interface ColorOption {
  /** Отображаемая метка (из первого вхождения / объявленного списка товара). */
  value: string;
  /** Hex из справочника; null — свотч отрисуется фолбэком палитры. */
  hex: string | null;
  /** Есть хотя бы один вариант этого цвета, который реально можно купить. */
  available: boolean;
}

/** Размер как опция выбора (доступность — в разрезе выбранного цвета). */
export interface SizeOption {
  size: string;
  available: boolean;
}

/** Объявленный список цветов товара (ProductDetailDto.colors). */
export interface DeclaredColor {
  value: string;
  hex?: string | null;
}

/** Состояние выбора на карточке. */
export interface MatrixSelection {
  color: string | null;
  size: string | null;
}

/**
 * Разрешённый выбор: метки + конкретный вариант (или null, пока выбор неполон).
 * Дженерик по типу варианта, чтобы вызывающий получал обратно СВОЙ тип
 * (StorefrontVariant с ценой), а не урезанный MatrixVariant.
 */
export interface ResolvedSelection<T extends MatrixVariant = MatrixVariant>
  extends MatrixSelection {
  variant: T | null;
}

// ---------------------------------------------------------------------------
// Низкоуровневые сравнения.
// ---------------------------------------------------------------------------

/** Реально покупаем: флаг наличия И положительный остаток (0 при inStock=true — не купить). */
function isBuyable(v: MatrixVariant): boolean {
  return v.inStock && v.availableQty > 0;
}

function normalizeSize(size: string | null | undefined): string {
  return (size ?? "").trim();
}

function matchesColor(v: MatrixVariant, color: string | null): boolean {
  if (color === null) return true;
  return normalizeColorName(v.color) === normalizeColorName(color);
}

function matchesSize(v: MatrixVariant, size: string | null): boolean {
  if (size === null) return true;
  return normalizeSize(v.size) === normalizeSize(size);
}

// ---------------------------------------------------------------------------
// Оси матрицы.
// ---------------------------------------------------------------------------

/** Заведён ли у товара цвет хотя бы у одного варианта. */
export function hasColors(variants: MatrixVariant[]): boolean {
  return variants.some((v) => normalizeColorName(v.color) !== "");
}

/** Есть ли у товара ось размеров (у вариантов непустая метка). */
export function hasSizes(variants: MatrixVariant[]): boolean {
  return variants.some((v) => normalizeSize(v.size) !== "");
}

/**
 * Уникальные цвета товара в порядке появления у вариантов.
 * `declared` (ProductDetailDto.colors) задаёт порядок и добирает hex; цвета из
 * declared, которых нет среди вариантов, отбрасываются (нечего выбирать), а
 * цвета вариантов, которых нет в declared, добавляются в конец.
 */
export function listColors(
  variants: MatrixVariant[],
  declared: DeclaredColor[] = [],
): ColorOption[] {
  const order: string[] = [];
  const label = new Map<string, string>();
  const hex = new Map<string, string | null>();

  const remember = (value: string | null | undefined, h: string | null | undefined) => {
    const key = normalizeColorName(value);
    if (!key) return;
    if (!label.has(key)) {
      order.push(key);
      label.set(key, (value as string).trim());
    }
    if (!hex.get(key) && h) hex.set(key, h);
  };

  // Порядок и hex сначала из объявленного списка товара, затем из вариантов.
  for (const c of declared) remember(c.value, c.hex ?? null);
  for (const v of variants) remember(v.color, v.colorHex ?? null);

  // Оставляем только те цвета, что реально есть у вариантов.
  const present = new Set(
    variants.map((v) => normalizeColorName(v.color)).filter((k) => k !== ""),
  );

  return order
    .filter((key) => present.has(key))
    .map((key) => ({
      value: label.get(key) as string,
      hex: hex.get(key) ?? null,
      available: variants.some((v) => normalizeColorName(v.color) === key && isBuyable(v)),
    }));
}

/**
 * Уникальные размеры товара в порядке появления. Доступность считается в разрезе
 * выбранного цвета: `color = null` → размер доступен, если доступен хоть в одном
 * цвете; иначе — только по вариантам этого цвета (нет варианта → недоступен).
 */
export function listSizes(variants: MatrixVariant[], color: string | null): SizeOption[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const v of variants) {
    const size = normalizeSize(v.size);
    if (!size || seen.has(size)) continue;
    seen.add(size);
    order.push(size);
  }
  return order.map((size) => ({
    size,
    available: variants.some((v) => matchesColor(v, color) && matchesSize(v, size) && isBuyable(v)),
  }));
}

// ---------------------------------------------------------------------------
// Разрешение пары (цвет, размер) → вариант.
// ---------------------------------------------------------------------------

/**
 * Вариант по паре (цвет, размер). Недоступный вариант ТОЖЕ возвращается (нужен
 * для подписи причины); при нескольких совпадениях предпочитается покупаемый.
 * null — такой комбинации у товара нет вовсе.
 */
export function findVariant<T extends MatrixVariant>(
  variants: T[],
  color: string | null,
  size: string | null,
): T | null {
  const candidates = variants.filter((v) => matchesColor(v, color) && matchesSize(v, size));
  return candidates.find(isBuyable) ?? candidates[0] ?? null;
}

/** Можно ли купить комбинацию (цвет, размер). */
export function isCombinationAvailable(
  variants: MatrixVariant[],
  color: string | null,
  size: string | null,
): boolean {
  return variants.some((v) => matchesColor(v, color) && matchesSize(v, size) && isBuyable(v));
}

/** Выбраны ли все оси, которые есть у товара. */
export function isSelectionComplete(
  variants: MatrixVariant[],
  sel: MatrixSelection,
): boolean {
  if (hasColors(variants) && sel.color === null) return false;
  if (hasSizes(variants) && sel.size === null) return false;
  return true;
}

/** Каноническая метка цвета товара (из справочника) по пользовательскому вводу. */
function canonicalColor(variants: MatrixVariant[], color: string): string {
  const key = normalizeColorName(color);
  const hit = listColors(variants).find((c) => normalizeColorName(c.value) === key);
  return hit ? hit.value : color.trim();
}

function resolve<T extends MatrixVariant>(
  variants: T[],
  sel: MatrixSelection,
): ResolvedSelection<T> {
  const variant = isSelectionComplete(variants, sel)
    ? findVariant(variants, sel.color, sel.size)
    : null;
  return { color: sel.color, size: sel.size, variant };
}

/**
 * Клик по свотчу цвета. Выбранный размер СОХРАНЯЕТСЯ, только если он доступен в
 * новом цвете, иначе сбрасывается (иначе пользователь остался бы с выбранным
 * размером, которого в этом цвете нет).
 */
export function selectColor<T extends MatrixVariant>(
  variants: T[],
  sel: MatrixSelection,
  color: string | null,
): ResolvedSelection<T> {
  const next = color === null ? null : canonicalColor(variants, color);
  const size =
    next === null
      ? sel.size
      : sel.size !== null && isCombinationAvailable(variants, next, sel.size)
        ? sel.size
        : null;
  return resolve(variants, { color: next, size });
}

/**
 * Клик по кнопке размера. Если цвет ещё не выбран, а он у товара ровно один —
 * подставляем его автоматически (выбирать не из чего, а вариант нужен).
 */
export function selectSize<T extends MatrixVariant>(
  variants: T[],
  sel: MatrixSelection,
  size: string | null,
): ResolvedSelection<T> {
  const colors = listColors(variants);
  let color = sel.color;
  if (color === null) {
    if (colors.length === 1) color = colors[0].value;
  } else {
    color = canonicalColor(variants, color);
  }
  return resolve(variants, { color, size: size === null ? null : normalizeSize(size) });
}

/**
 * Синхронизация счётчика количества со сменой варианта: не даём остаться
 * количеству больше остатка. Вариант сброшен (комбинация распалась) → 1.
 */
export function clampQuantity(quantity: number, variant: MatrixVariant | null): number {
  if (!variant) return 1;
  return Math.max(1, Math.min(quantity, Math.max(1, variant.availableQty)));
}

/**
 * Причина недоступности цвета для `title`/`aria-label` (по аналогии с
 * variantUnavailableLabel): приглушённая кнопка иначе озвучивается лишь как
 * «dimmed», без причины.
 */
export function colorUnavailableLabel(option: ColorOption): string | null {
  if (option.available) return null;
  return `Цвет ${option.value} — нет в наличии`;
}

/** Как показывать цвет на карточке: селектором, статичной подписью или никак. */
export type ColorDisplayMode =
  | { mode: "selector" }
  | { mode: "static"; value: string }
  | { mode: "none" };

/**
 * Режим показа цвета (совместимость со «старой» раскладкой данных).
 *
 * Цвет как ВАРИАНТНАЯ ось появился в спринте B. У магазина, который ещё не
 * перевёл каталог, цвет лежит атрибутом ТОВАРА — тогда вариантных опций нет,
 * и блок цвета молча исчезал бы с карточки (регрессия, пойманная на проде).
 *
 * Товарный цвет НЕЛЬЗЯ подмешивать в опции: под него нет ни одного варианта,
 * опция пришла бы с available=false, needsColor встал бы в true и кнопка
 * «В корзину» заблокировалась бы навсегда. Поэтому фолбэк — только показ.
 */
export function colorDisplayMode(
  colorOptions: readonly ColorOption[],
  productColor: string | null | undefined,
): ColorDisplayMode {
  if (colorOptions.length > 0) return { mode: "selector" };
  const value = (productColor ?? "").trim();
  return value ? { mode: "static", value } : { mode: "none" };
}
