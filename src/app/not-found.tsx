import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="page-transition pt-16 md:pt-20 min-h-[70vh] flex items-center justify-center">
      <div className="text-center px-4">
        <p className="text-[120px] md:text-[180px] font-light text-surface leading-none select-none">
          404
        </p>
        <div className="accent-line mx-auto mb-6 -mt-4" />
        <h1 className="heading-md mb-4">Страница не найдена</h1>
        <p className="text-sm text-muted mb-10 max-w-sm mx-auto">
          Запрашиваемая страница не существует или была перемещена
        </p>
        <Link href="/">
          <Button variant="primary" size="lg" magnetic>
            На главную
          </Button>
        </Link>
      </div>
    </div>
  );
}
