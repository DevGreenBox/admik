// Свотч цвета (Мадина №6/№5): название цвета → hex для кружка-образца.
// Общий источник для карточки товара (выбор) и фильтра каталога (фасет).
const COLOR_SWATCHES: Record<string, string> = {
  белый: "#ffffff",
  графит: "#3a3a3d",
  чёрный: "#1a1a1a",
  черный: "#1a1a1a",
  серый: "#8a8a8a",
  синий: "#2b3a55",
  бежевый: "#d8cbb8",
};

export function colorHex(name: string): string {
  return COLOR_SWATCHES[name.trim().toLowerCase()] ?? "#c8c8c8";
}
