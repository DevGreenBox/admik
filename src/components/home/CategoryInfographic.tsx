import Link from "next/link";

type InfographicProps = {
  index: number;
  stats: readonly string[];
  children: React.ReactNode;
};

function InfographicCard({ index, stats, children }: InfographicProps) {
  return (
    <div className="flex h-full min-h-[140px] flex-col items-center justify-between border border-border bg-surface px-3 py-4 md:min-h-[152px] md:px-5 md:py-5 transition-colors duration-700 group-hover:border-graphite">
      <span className="text-[9px] uppercase tracking-[0.24em] text-muted tabular-nums">
        {String(index).padStart(2, "0")}
      </span>

      <div className="flex h-14 w-full items-center justify-center">{children}</div>

      <div className="w-full">
        <div className="accent-line-sm mx-auto mb-3 w-6" />
        <ul className="space-y-1 text-center">
          {stats.map((stat) => (
            <li key={stat} className="text-[8px] uppercase tracking-[0.14em] text-graphite/70 leading-relaxed">
              {stat}
            </li>
          ))}
        </ul>
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

const INFOGRAPHICS = [
  {
    slug: "suits",
    label: "Костюмы",
    stats: ["3 кроя", "Premium ткань"],
    Graphic: SuitsGraphic,
  },
  {
    slug: "coats",
    label: "Халаты",
    stats: ["4 длины", "Клинический крой"],
    Graphic: CoatsGraphic,
  },
  {
    slug: "accessories",
    label: "Аксессуары",
    stats: ["12+ позиций", "Минимализм"],
    Graphic: AccessoriesGraphic,
  },
] as const;

export function CategoryInfographics() {
  return (
    <div className="flex flex-row items-stretch gap-2 md:gap-6 lg:gap-8">
      {INFOGRAPHICS.map(({ slug, label, stats, Graphic }, i) => (
        <Link key={slug} href={`/catalog?category=${slug}`} className="group flex flex-1 flex-col">
          <InfographicCard index={i + 1} stats={stats}>
            <Graphic />
          </InfographicCard>
          <p className="mt-2 min-h-[1.25rem] text-center text-[8px] uppercase tracking-[0.16em] text-muted group-hover:text-graphite transition-colors duration-700">
            {label}
          </p>
        </Link>
      ))}
    </div>
  );
}
