import { describe, it, expect, vi, beforeEach } from "vitest";

// Мокаем клиент Admik и тяжёлый клиентский CatalogPage, чтобы выполнить серверный
// компонент страницы каталога в node-окружении.
//
// ВАЖНО: node-vitest компилирует JSX в классический React.createElement, поэтому
// рендер JSX (успешная ветка) в node падает на «React is not defined». Поэтому здесь
// проверяется ТОЛЬКО ветка ошибки загрузки товаров — она бросает ДО return/JSX. Тест
// дискриминирующий по СООБЩЕНИЮ: до фикса (try/catch глушит и идёт в JSX) Catalog
// бросает ReferenceError «React is not defined»; после фикса — пробрасывает ошибку
// бэкенда («backend down») в error-границу. Успешный пустой ответ и деградацию
// категорий проверяем ручным прогоном (playwright).
const listProducts = vi.fn();
const getCategories = vi.fn();
vi.mock("@/lib/admik", () => ({
  listProducts: (...a: unknown[]) => listProducts(...a),
  getCategories: (...a: unknown[]) => getCategories(...a),
  fromListItem: (x: unknown) => x,
}));
vi.mock("@/components/catalog/CatalogPage", () => ({ CatalogPage: () => null }));

beforeEach(() => {
  listProducts.mockReset();
  getCategories.mockReset();
});

describe("#24 catalog page — сбой бэкенда пробрасывается, а не глушится в пустой каталог", () => {
  it("ошибка listProducts всплывает в error-границу (с исходным сообщением)", async () => {
    listProducts.mockRejectedValue(new Error("backend down"));
    getCategories.mockResolvedValue([]);
    const { default: Catalog } = await import("@/app/catalog/page");
    await expect(
      Catalog({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("backend down");
  });
});
