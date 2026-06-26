import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdmikPageDto, AdmikSeoMetaDto } from "@/lib/admik";

// Контролируемый getCmsPage + лёгкие заглушки тяжёлых компонентов (CmsPageView/
// Animations), чтобы импортировать серверные модули страниц в node-окружении.
const getCmsPage = vi.fn();
vi.mock("@/lib/cms", () => ({
  getCmsPage: (...args: unknown[]) => getCmsPage(...args),
}));
vi.mock("@/components/cms/CmsPageView", () => ({ CmsPageView: () => null }));
vi.mock("@/components/ui/Animations", () => ({
  FadeIn: () => null,
  TextReveal: () => null,
}));

function meta(over: Partial<AdmikSeoMetaDto> = {}): AdmikSeoMetaDto {
  return { title: "", description: null, ...over };
}
function page(over: Partial<AdmikPageDto> = {}): AdmikPageDto {
  return {
    slug: over.slug ?? "payment",
    title: over.title ?? "Заголовок страницы",
    meta: over.meta ?? meta(),
    sections: over.sections ?? [],
  };
}

beforeEach(() => {
  getCmsPage.mockReset();
});

describe("#29 payment generateMetadata — SEO из CMS с фолбэком", () => {
  it("берёт title/description из page.meta, заданных владельцем", async () => {
    getCmsPage.mockResolvedValue(
      page({ meta: meta({ title: "Оплата онлайн", description: "Как оплатить заказ" }) }),
    );
    const { generateMetadata } = await import("@/app/payment/page");
    const m = await generateMetadata();
    expect(m.title).toBe("Оплата онлайн");
    expect(m.description).toBe("Как оплатить заказ");
  });

  it("meta.description = null → фолбэк на статическое описание страницы", async () => {
    getCmsPage.mockResolvedValue(
      page({ meta: meta({ title: "Оплата онлайн", description: null }) }),
    );
    const { generateMetadata } = await import("@/app/payment/page");
    const m = await generateMetadata();
    expect(m.title).toBe("Оплата онлайн");
    expect(m.description).toBe(
      "Способы оплаты заказов в интернет-магазине THE CASE.",
    );
  });

  it("страницы нет (null) → статический фолбэк страницы", async () => {
    getCmsPage.mockResolvedValue(null);
    const { generateMetadata } = await import("@/app/payment/page");
    const m = await generateMetadata();
    expect(m.title).toBe("Оплата — THE CASE");
    expect(typeof m.description).toBe("string");
  });
});

describe("#29 reviews generateMetadata — SEO из CMS с фолбэком", () => {
  it("берёт title/description из page.meta", async () => {
    getCmsPage.mockResolvedValue(
      page({ slug: "reviews", meta: meta({ title: "Отзывы клиентов", description: "Фотоотзывы" }) }),
    );
    const { generateMetadata } = await import("@/app/reviews/page");
    const m = await generateMetadata();
    expect(m.title).toBe("Отзывы клиентов");
    expect(m.description).toBe("Фотоотзывы");
  });

  it("страницы нет (null) → статический фолбэк страницы", async () => {
    getCmsPage.mockResolvedValue(null);
    const { generateMetadata } = await import("@/app/reviews/page");
    const m = await generateMetadata();
    expect(m.title).toBe("ВЫ + THE CASE — отзывы");
    expect(typeof m.description).toBe("string");
  });
});
