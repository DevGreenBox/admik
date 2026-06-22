import { describe, it, expect } from "vitest";
import { pluralRu } from "@/lib/plural";

const F: [string, string, string] = ["результат", "результата", "результатов"];

describe("pluralRu — русское склонение по числу", () => {
  it("1, 21, 31 → форма [0]", () => {
    for (const n of [1, 21, 31, 101]) expect(pluralRu(n, F)).toBe("результат");
  });
  it("2–4, 22–24 → форма [1]", () => {
    for (const n of [2, 3, 4, 22, 23, 24, 102]) expect(pluralRu(n, F)).toBe("результата");
  });
  it("0, 5–20, 25, 100 → форма [2]", () => {
    for (const n of [0, 5, 9, 10, 11, 12, 13, 14, 15, 20, 25, 100]) expect(pluralRu(n, F)).toBe("результатов");
  });
  it("11–14 — исключения (форма [2], не [0]/[1])", () => {
    for (const n of [11, 12, 13, 14]) expect(pluralRu(n, F)).toBe("результатов");
  });
});
