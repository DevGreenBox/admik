"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { recordPageview } from "@/lib/admik";
import { decidePageview } from "@/lib/pageview-dedupe";

/**
 * Beacon посещений (F23): на каждый УНИКАЛЬНЫЙ переход маршрута шлёт лёгкий
 * POST /events/pageview в Admik — наполняет график «Посещения» на дашборде.
 *
 * Дедупликация по pathname через useRef (decidePageview) защищает от двойного
 * счёта при повторном прогоне эффекта и в React strict-mode (dev), где эффекты
 * монтируются дважды. usePathname намеренно БЕЗ useSearchParams — посещение
 * считаем по пути страницы, а не по каждому изменению query (фильтры/сортировки
 * каталога иначе раздували бы счётчик).
 *
 * Ничего не рендерит. recordPageview мягко деградирует (ошибки глотает), поэтому
 * аналитика не влияет на UX витрины.
 */
export default function PageviewBeacon() {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    const { send, nextKey } = decidePageview(lastSent.current, pathname);
    if (!send) return;
    lastSent.current = nextKey;
    void recordPageview();
  }, [pathname]);

  return null;
}
