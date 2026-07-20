import { describe, it, expect } from "vitest";
import {
  listColors,
  listSizes,
  hasColors,
  findVariant,
  isCombinationAvailable,
  isSelectionComplete,
  selectColor,
  selectSize,
  clampQuantity,
  colorUnavailableLabel,
  type MatrixVariant,
} from "@/lib/variant-matrix";

function v(over: Partial<MatrixVariant> & { id: string }): MatrixVariant {
  return {
    id: over.id,
    size: over.size ?? "M",
    color: over.color ?? null,
    colorHex: over.colorHex ?? null,
    inStock: over.inStock ?? true,
    availableQty: over.availableQty ?? 5,
  };
}

/** Матрица 2 цвета × 2 размера. */
const MATRIX: MatrixVariant[] = [
  v({ id: "w-s", color: "Белый", colorHex: "#ffffff", size: "S" }),
  v({ id: "w-m", color: "Белый", colorHex: "#ffffff", size: "M" }),
  v({ id: "b-s", color: "Чёрный", colorHex: "#111111", size: "S", inStock: false, availableQty: 0 }),
  v({ id: "b-m", color: "Чёрный", colorHex: "#111111", size: "M" }),
];

describe("hasColors", () => {
  it("true, если хотя бы у одного варианта задан цвет", () => {
    expect(hasColors(MATRIX)).toBe(true);
  });

  it("false для вариантов без цвета (только размеры) и для пустого списка", () => {
    expect(hasColors([v({ id: "a", size: "S" }), v({ id: "b", size: "M" })])).toBe(false);
    expect(hasColors([])).toBe(false);
  });

  it("пустая строка/пробелы не считаются цветом", () => {
    expect(hasColors([v({ id: "a", color: "   " })])).toBe(false);
  });
});

describe("listColors", () => {
  it("уникальные цвета в порядке появления у вариантов, с hex", () => {
    expect(listColors(MATRIX)).toEqual([
      { value: "Белый", hex: "#ffffff", available: true },
      { value: "Чёрный", hex: "#111111", available: true },
    ]);
  });

  it("цвет недоступен, если все его варианты распроданы", () => {
    const out = listColors([
      v({ id: "w", color: "Белый", size: "S" }),
      v({ id: "b1", color: "Чёрный", size: "S", inStock: false, availableQty: 0 }),
      v({ id: "b2", color: "Чёрный", size: "M", inStock: false, availableQty: 0 }),
    ]);
    expect(out.map((c) => [c.value, c.available])).toEqual([
      ["Белый", true],
      ["Чёрный", false],
    ]);
  });

  it("остаток 0 при inStock=true всё равно считается недоступным", () => {
    const out = listColors([v({ id: "w", color: "Белый", inStock: true, availableQty: 0 })]);
    expect(out[0].available).toBe(false);
  });

  it("цветов нет вовсе → пустой массив", () => {
    expect(listColors([v({ id: "a", size: "S" })])).toEqual([]);
    expect(listColors([])).toEqual([]);
  });

  it("один цвет → один вариант выбора", () => {
    const out = listColors([
      v({ id: "a", color: "Белый", colorHex: "#ffffff", size: "S" }),
      v({ id: "b", color: "Белый", colorHex: "#ffffff", size: "M" }),
    ]);
    expect(out).toEqual([{ value: "Белый", hex: "#ffffff", available: true }]);
  });

  it("объявленный список товара задаёт порядок и добирает hex", () => {
    const out = listColors(
      [
        v({ id: "b", color: "Чёрный", size: "S" }),
        v({ id: "w", color: "Белый", size: "S" }),
      ],
      [
        { value: "Белый", hex: "#ffffff" },
        { value: "Чёрный", hex: "#111111" },
      ],
    );
    expect(out).toEqual([
      { value: "Белый", hex: "#ffffff", available: true },
      { value: "Чёрный", hex: "#111111", available: true },
    ]);
  });

  it("цвет, которого нет среди вариантов, из объявленного списка отбрасывается", () => {
    const out = listColors([v({ id: "w", color: "Белый", size: "S" })], [
      { value: "Белый", hex: "#ffffff" },
      { value: "Синий", hex: "#0000ff" },
    ]);
    expect(out.map((c) => c.value)).toEqual(["Белый"]);
  });

  it("цвет вариантов, отсутствующий в объявленном списке, добавляется в конец", () => {
    const out = listColors(
      [v({ id: "w", color: "Белый" }), v({ id: "g", color: "Графит" })],
      [{ value: "Белый", hex: "#ffffff" }],
    );
    expect(out.map((c) => c.value)).toEqual(["Белый", "Графит"]);
  });

  it("регистр и ё/е не плодят дублей, метка берётся из первого вхождения", () => {
    const out = listColors([
      v({ id: "a", color: "Чёрный" }),
      v({ id: "b", color: "черный" }),
      v({ id: "c", color: "ЧЁРНЫЙ" }),
    ]);
    expect(out.map((c) => c.value)).toEqual(["Чёрный"]);
  });
});

describe("listSizes", () => {
  it("без выбранного цвета — все размеры товара, уникально, в порядке появления", () => {
    expect(listSizes(MATRIX, null).map((s) => s.size)).toEqual(["S", "M"]);
  });

  it("для выбранного цвета доступность считается по вариантам этого цвета", () => {
    expect(listSizes(MATRIX, "Чёрный")).toEqual([
      { size: "S", available: false },
      { size: "M", available: true },
    ]);
    expect(listSizes(MATRIX, "Белый")).toEqual([
      { size: "S", available: true },
      { size: "M", available: true },
    ]);
  });

  it("без цвета размер доступен, если доступен хотя бы в одном цвете", () => {
    expect(listSizes(MATRIX, null)).toEqual([
      { size: "S", available: true },
      { size: "M", available: true },
    ]);
  });

  it("размер, которого нет в выбранном цвете, помечается недоступным", () => {
    const vars = [
      v({ id: "w-s", color: "Белый", size: "S" }),
      v({ id: "w-m", color: "Белый", size: "M" }),
      v({ id: "b-s", color: "Чёрный", size: "S" }),
    ];
    expect(listSizes(vars, "Чёрный")).toEqual([
      { size: "S", available: true },
      { size: "M", available: false },
    ]);
  });

  it("вариантов нет → пустой список", () => {
    expect(listSizes([], null)).toEqual([]);
  });
});

describe("findVariant / isCombinationAvailable", () => {
  it("находит вариант по паре (цвет, размер)", () => {
    expect(findVariant(MATRIX, "Чёрный", "M")?.id).toBe("b-m");
    expect(findVariant(MATRIX, "Белый", "S")?.id).toBe("w-s");
  });

  it("сравнение цвета регистронезависимо и с нормализацией ё→е", () => {
    expect(findVariant(MATRIX, "черный", "M")?.id).toBe("b-m");
    expect(findVariant(MATRIX, "  БЕЛЫЙ  ", "S")?.id).toBe("w-s");
  });

  it("несуществующая комбинация → null", () => {
    expect(findVariant(MATRIX, "Синий", "M")).toBeNull();
    expect(findVariant(MATRIX, "Белый", "XXL")).toBeNull();
  });

  it("товар без цветов: вариант ищется по одному размеру", () => {
    const vars = [v({ id: "s", size: "S" }), v({ id: "m", size: "M" })];
    expect(findVariant(vars, null, "M")?.id).toBe("m");
  });

  it("недоступная комбинация всё равно находится, но помечена недоступной", () => {
    expect(findVariant(MATRIX, "Чёрный", "S")?.id).toBe("b-s");
    expect(isCombinationAvailable(MATRIX, "Чёрный", "S")).toBe(false);
    expect(isCombinationAvailable(MATRIX, "Чёрный", "M")).toBe(true);
    expect(isCombinationAvailable(MATRIX, "Синий", "M")).toBe(false);
  });

  it("предпочитает вариант в наличии, если совпадений несколько", () => {
    const vars = [
      v({ id: "dead", color: "Белый", size: "S", inStock: false, availableQty: 0 }),
      v({ id: "live", color: "Белый", size: "S" }),
    ];
    expect(findVariant(vars, "Белый", "S")?.id).toBe("live");
  });
});

describe("isSelectionComplete", () => {
  it("матрица требует и цвет, и размер", () => {
    expect(isSelectionComplete(MATRIX, { color: null, size: "M" })).toBe(false);
    expect(isSelectionComplete(MATRIX, { color: "Белый", size: null })).toBe(false);
    expect(isSelectionComplete(MATRIX, { color: "Белый", size: "M" })).toBe(true);
  });

  it("товар без цветов требует только размер", () => {
    const vars = [v({ id: "s", size: "S" })];
    expect(isSelectionComplete(vars, { color: null, size: "S" })).toBe(true);
    expect(isSelectionComplete(vars, { color: null, size: null })).toBe(false);
  });
});

describe("selectColor", () => {
  it("сохраняет размер, если он доступен в новом цвете", () => {
    const sel = selectColor(MATRIX, { color: "Белый", size: "M" }, "Чёрный");
    expect(sel.color).toBe("Чёрный");
    expect(sel.size).toBe("M");
    expect(sel.variant?.id).toBe("b-m");
  });

  it("сбрасывает размер, если в новом цвете он недоступен", () => {
    const sel = selectColor(MATRIX, { color: "Белый", size: "S" }, "Чёрный");
    expect(sel.color).toBe("Чёрный");
    expect(sel.size).toBeNull();
    expect(sel.variant).toBeNull();
  });

  it("сбрасывает размер, если в новом цвете такого размера нет вовсе", () => {
    const vars = [
      v({ id: "w-xl", color: "Белый", size: "XL" }),
      v({ id: "b-m", color: "Чёрный", size: "M" }),
    ];
    const sel = selectColor(vars, { color: "Белый", size: "XL" }, "Чёрный");
    expect(sel.size).toBeNull();
    expect(sel.variant).toBeNull();
  });

  it("метка цвета нормализуется к варианту товара (регистр/ё)", () => {
    const sel = selectColor(MATRIX, { color: null, size: null }, "черный");
    expect(sel.color).toBe("Чёрный");
  });

  it("выбор цвета без размера не резолвит вариант", () => {
    const sel = selectColor(MATRIX, { color: null, size: null }, "Белый");
    expect(sel.size).toBeNull();
    expect(sel.variant).toBeNull();
  });

  it("сброс цвета в null очищает вариант, но помнит размер", () => {
    const sel = selectColor(MATRIX, { color: "Белый", size: "M" }, null);
    expect(sel.color).toBeNull();
    expect(sel.size).toBe("M");
    expect(sel.variant).toBeNull();
  });
});

describe("selectSize", () => {
  it("резолвит вариант по паре с уже выбранным цветом", () => {
    const sel = selectSize(MATRIX, { color: "Белый", size: null }, "M");
    expect(sel.variant?.id).toBe("w-m");
  });

  it("товар без цветов резолвит вариант по одному размеру", () => {
    const vars = [v({ id: "s", size: "S" }), v({ id: "m", size: "M" })];
    const sel = selectSize(vars, { color: null, size: null }, "M");
    expect(sel.color).toBeNull();
    expect(sel.variant?.id).toBe("m");
  });

  it("если цвет ещё не выбран, но товар цветной — вариант не резолвится", () => {
    const sel = selectSize(MATRIX, { color: null, size: null }, "M");
    expect(sel.size).toBe("M");
    expect(sel.variant).toBeNull();
  });

  it("товар с одним цветом: цвет подставляется автоматически", () => {
    const vars = [
      v({ id: "w-s", color: "Белый", size: "S" }),
      v({ id: "w-m", color: "Белый", size: "M" }),
    ];
    const sel = selectSize(vars, { color: null, size: null }, "M");
    expect(sel.color).toBe("Белый");
    expect(sel.variant?.id).toBe("w-m");
  });
});

describe("clampQuantity", () => {
  it("режет количество до остатка выбранного варианта", () => {
    expect(clampQuantity(5, v({ id: "a", availableQty: 2 }))).toBe(2);
  });

  it("не опускает ниже 1 даже при нулевом остатке", () => {
    expect(clampQuantity(5, v({ id: "a", availableQty: 0, inStock: false }))).toBe(1);
  });

  it("без выбранного варианта количество сбрасывается на 1 (нет известного лимита)", () => {
    expect(clampQuantity(7, null)).toBe(1);
  });

  it("количество меньше остатка не меняется", () => {
    expect(clampQuantity(2, v({ id: "a", availableQty: 9 }))).toBe(2);
  });
});

describe("colorUnavailableLabel", () => {
  it("для доступного цвета причины нет", () => {
    expect(colorUnavailableLabel({ value: "Белый", hex: null, available: true })).toBeNull();
  });

  it("для распроданного цвета даёт RU-причину", () => {
    expect(colorUnavailableLabel({ value: "Чёрный", hex: null, available: false })).toBe(
      "Цвет Чёрный — нет в наличии",
    );
  });
});
