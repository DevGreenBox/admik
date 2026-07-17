import Link from "next/link";
import { topCategoryLinks } from "@/lib/catalog-view";
import type { AdmikCategoryDto } from "@/lib/admik";

type InfographicProps = {
  index: number;
  description: string;
  children: React.ReactNode;
};

function InfographicCard({ index, description, children }: InfographicProps) {
  return (
    <div className="flex h-full min-h-[140px] flex-col items-center justify-between border border-border bg-surface px-3 py-4 md:min-h-[152px] md:px-5 md:py-5 transition-colors duration-700 group-hover:border-graphite">
      <span className="text-[9px] uppercase tracking-[0.24em] text-muted tabular-nums">
        {String(index).padStart(2, "0")}
      </span>

      <div className="flex h-14 w-full items-center justify-center">{children}</div>

      <div className="w-full">
        <div className="accent-line-sm mx-auto mb-3 w-6" />
        {/* Подпись — description категории из админки. Пусто → строка-распорка,
            чтобы плитки в ряду остались одной высоты. */}
        <p className="min-h-[1rem] text-center text-[8px] uppercase tracking-[0.14em] text-graphite/70 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}

function SuitsGraphic() {
  return (
    <svg viewBox="0 0 120 140" className="h-12 w-10 md:h-14 md:w-11" aria-hidden>
      <rect x="30" y="8" width="60" height="52" fill="none" stroke="currentColor" strokeWidth="1" className="text-graphite" />
      <path d="M30 28 L60 42 L90 28" fill="none" stroke="currentColor" strokeWidth="1" className="text-graphite" />
      <line x1="60" y1="42" x2="60" y2="60" stroke="currentColor" strokeWidth="1" className="text-graphite" />
      <rect x="38" y="62" width="44" height="68" fill="none" stroke="currentColor" strokeWidth="1" className="text-graphite" />
    </svg>
  );
}

function CoatsGraphic() {
  return (
    <svg viewBox="0 0 120 140" className="h-12 w-10 md:h-14 md:w-11" aria-hidden>
      <path
        d="M42 12 L60 24 L78 12 L88 28 L88 132 L32 132 L32 28 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        className="text-graphite"
      />
      <rect x="52" y="72" width="16" height="14" fill="none" stroke="currentColor" strokeWidth="0.75" className="text-muted" />
    </svg>
  );
}

function AccessoriesGraphic() {
  return (
    <svg viewBox="0 0 120 140" className="h-12 w-10 md:h-14 md:w-11" aria-hidden>
      <rect x="18" y="24" width="36" height="28" rx="2" fill="none" stroke="currentColor" strokeWidth="1" className="text-graphite" />
      <circle cx="78" cy="38" r="16" fill="none" stroke="currentColor" strokeWidth="1" className="text-graphite" />
      <rect x="24" y="88" width="28" height="36" rx="2" fill="none" stroke="currentColor" strokeWidth="1" className="text-graphite" />
    </svg>
  );
}

// Графика — фирменный ДЕКОР, а не иллюстрация конкретной категории: категории
// приезжают из каталога любого магазина, поля под картинку у них в БД нет.
// Раздаём по кругу, чтобы у каждой плитки был рисунок и соседние отличались.
const GRAPHICS = [SuitsGraphic, CoatsGraphic, AccessoriesGraphic] as const;

/** Сколько плиток показываем: больше — ряд из flex-1 схлопывается в полоски. */
const MAX_TILES = 3;

export function CategoryInfographics({
  categories = [],
}: {
  categories?: AdmikCategoryDto[];
}) {
  // Категории верхнего уровня из РЕАЛЬНОГО каталога (порядок — sort из админки).
  // Раньше плитки были захардкожены (Костюмы/Халаты/Аксессуары) и две из трёх
  // вели в общий /catalog, потому что таких категорий в каталоге нет.
  const tiles = topCategoryLinks(categories, MAX_TILES);

  // Каталог пуст или не ответил (таймаут getCategories → []) — секции нет вовсе,
  // иначе на главной висел бы заголовок «Категории» над пустотой.
  if (tiles.length === 0) return null;

  return (
    <div className="flex flex-row items-stretch gap-2 md:gap-6 lg:gap-8">
      {tiles.map(({ slug, name, description, href }, i) => {
        const Graphic = GRAPHICS[i % GRAPHICS.length];
        return (
          <Link key={slug} href={href} className="group flex flex-1 flex-col">
            <InfographicCard index={i + 1} description={description}>
              <Graphic />
            </InfographicCard>
            <p className="mt-2 min-h-[1.25rem] text-center text-[8px] uppercase tracking-[0.16em] text-muted group-hover:text-graphite transition-colors duration-700">
              {name}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
