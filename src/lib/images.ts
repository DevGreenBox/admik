/** Пути к ассетам — npm run foto (ТЗ strict) */
export const IMAGES = {
  hero: {
    splitWomen: "/images/hero/split-women.webp",
    splitMen: "/images/hero/split-men.webp",
  },
  home: {
    banner: "/images/home/banner-main.webp",
  },
  editorial: {
    womenPortrait: "/images/editorial/women-portrait.webp",
    menPortrait: "/images/editorial/men-portrait.webp",
    duo: "/images/editorial/duo.webp",
  },
  categories: {
    womenViews: [
      "/images/categories/women-front.webp",
      "/images/categories/women-side.webp",
      "/images/categories/women-back.webp",
    ],
    menViews: [
      "/images/categories/men-front.webp",
      "/images/categories/men-side.webp",
      "/images/categories/men-back.webp",
    ],
  },
  products: {
    bestseller14: "/images/products/bestseller-14.webp",
    bestseller15: "/images/products/bestseller-15.webp",
    bestseller16: "/images/products/bestseller-16.webp",
    bestseller17: "/images/products/bestseller-17.webp",
  },
  lookbook: [
    "/images/lookbook/lb-13.webp",
    "/images/lookbook/lb-16.webp",
    "/images/lookbook/lb-17.webp",
  ],
  details: Array.from({ length: 12 }, (_, i) => `/images/details/detail-${String(i + 1).padStart(2, "0")}.webp`),
  detailLabels: [
    "Воротник и молния", "Карман", "Рукав", "Боковой шов",
    "Бирка THE CASE", "Молния", "Спинка", "Пояс",
    "Карман на молнии", "Фактура ткани", "Разрез", "Hangtag",
  ],
  about: {
    duo: "/images/about/duo.webp",
  },
  delivery: {
    packaging: "/images/delivery/packaging.webp",
    box: "/images/delivery/box.webp",
  },
  checkout: {
    bg: "/images/delivery/box.webp",
  },
  footer: {
    bg: "/images/footer/bg.webp",
  },
} as const;

/** Карусель Bestsellers — Selection block */
export const BESTSELLER_CAROUSEL = [
  IMAGES.products.bestseller14, // Костюм Essential (women) — ф10
  IMAGES.products.bestseller15, // Tunic Classic — ф1
  IMAGES.products.bestseller16, // Костюм Essential (men) — ф11
  IMAGES.products.bestseller17, // Костюм №1 — ф2
] as const;

/** Primary + hover alternate for luxury image swap */
export const BESTSELLER_HOVER: readonly [string, string][] = [
  [IMAGES.products.bestseller14, IMAGES.categories.womenViews[1]],
  [IMAGES.products.bestseller15, IMAGES.details[0]],
  [IMAGES.products.bestseller16, IMAGES.categories.menViews[1]],
  [IMAGES.products.bestseller17, IMAGES.categories.menViews[2]],
];

export const EDITORIAL_HOVER = {
  women: IMAGES.categories.womenViews[1],
  men: IMAGES.categories.menViews[1],
  duo: IMAGES.lookbook[0],
} as const;

export function categoryViewHover(views: readonly string[], index: number): string {
  return views[(index + 1) % views.length] ?? views[index];
}

export function productImagesFor(_gender: "women" | "men" | "unisex", index = 0, _slug?: string): string[] {
  const pair = BESTSELLER_HOVER[index % BESTSELLER_HOVER.length];
  return [...pair];
}
