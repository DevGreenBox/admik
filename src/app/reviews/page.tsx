import { FadeIn } from "@/components/ui/Animations";

export const metadata = {
  title: "ВЫ + THE CASE — отзывы",
  description: "Фотоотзывы покупателей THE CASE — врачи и медперсонал в форме бренда.",
};

// TODO(контент клиента): заменить placeholders на реальные фотоотзывы
// (фото + имя/город/специальность). Источник фото — клиент пришлёт отдельно.
const REVIEWS_PLACEHOLDER = Array.from({ length: 6 });

export default function ReviewsPage() {
  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="container-brand py-12 md:py-16">
        <FadeIn>
          <div className="max-w-2xl mb-12 md:mb-16">
            <p className="eyebrow mb-6">Community</p>
            <h1 className="heading-lg heading-rule mb-6">ВЫ + THE CASE</h1>
            <p className="body-editorial">
              Врачи и медперсонал в форме THE CASE. Поделитесь своим фото —
              напишите нам в Telegram, и оно появится здесь.
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
          {REVIEWS_PLACEHOLDER.map((_, i) => (
            <FadeIn key={i} delay={i * 0.05}>
              <div className="aspect-[3/4] bg-surface flex items-center justify-center">
                <span className="text-[10px] uppercase tracking-[0.2em] text-muted">
                  Ваше фото
                </span>
              </div>
            </FadeIn>
          ))}
        </div>

        <FadeIn>
          <p className="mt-12 text-sm text-muted">
            Хотите попасть в галерею? Пришлите фото в&nbsp;
            <a href="/#contacts" className="link-underline text-graphite">поддержку</a>.
          </p>
        </FadeIn>
      </div>
    </div>
  );
}
