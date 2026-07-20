"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Ruler } from "lucide-react";
import { selectSizeCharts, getCell, type SizeChart } from "@/lib/size-table";

/**
 * Таблица размеров товара. Данные приходят ИЗ НАСТРОЕК магазина (`sizeCharts`),
 * зашитых сеток здесь нет — колонки рендерятся из `chart.columns`, поэтому один
 * компонент обслуживает любой ассортимент и любой магазин на платформе.
 *
 * Логика выбора сетки по полу живёт в чистом модуле `@/lib/size-table`
 * (selectSizeCharts) и покрыта юнит-тестами; компонент только рендерит.
 * Если подходящих сеток нет — не рендерится НИЧЕГО, включая кнопку.
 */
interface SizeGuideProps {
  /** Сетки из настроек магазина (как есть, без предварительной фильтрации). */
  charts: SizeChart[] | null | undefined;
  /** Пол товара (произвольная строка из атрибутов); определяет выбор сетки. */
  gender?: string | null;
  /** Общая сноска под таблицей из настроек. */
  footnote?: string;
}

export function SizeGuide({ charts, gender, footnote }: SizeGuideProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const visible = selectSizeCharts(charts, gender);
  const active = visible.find((c) => c.id === activeId) ?? visible[0] ?? null;

  // Портал нужен, чтобы fixed-модалка не зависела от трансформированных предков
  // (FadeIn/framer-motion на карточке товара) и центрировалась по вьюпорту,
  // а не «опускалась вниз» внутри transform-контейнера.
  useEffect(() => setMounted(true), []);

  // Блокируем скролл фона, пока открыта таблица.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Магазин не заполнил размерные сетки — таблицы (и кнопки) нет вовсе.
  if (!active) return null;

  const modal = (
    <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
              className="bg-white w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="accent-line-sm mb-3" />
                  <h3 className="heading-md">{active.title || "Таблица размеров"}</h3>
                  {active.note && (
                    <p className="text-[10px] text-muted mt-2 tracking-wide">{active.note}</p>
                  )}
                </div>
                <button onClick={() => setOpen(false)} aria-label="Закрыть">
                  <X className="h-5 w-5" strokeWidth={1.5} />
                </button>
              </div>

              {/* Несколько сеток (женская/мужская/обувь…) — переключаются вкладками. */}
              {visible.length > 1 && (
                <div className="flex flex-wrap gap-2 mb-6">
                  {visible.map((chart) => (
                    <button
                      key={chart.id}
                      onClick={() => setActiveId(chart.id)}
                      aria-pressed={chart.id === active.id}
                      className={
                        chart.id === active.id
                          ? "border border-graphite px-3 py-2 text-[10px] uppercase tracking-[0.12em]"
                          : "border border-border px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-muted hover:text-graphite transition-colors"
                      }
                    >
                      {chart.title}
                    </button>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {active.columns.map((col) => (
                        <th
                          key={col.key}
                          className="text-left py-3 text-[10px] uppercase tracking-[0.12em] text-muted font-normal"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {active.rows.map((row, i) => (
                      <tr key={i} className="border-b border-border/50">
                        {active.columns.map((col, ci) => (
                          <td
                            key={col.key}
                            className={ci === 0 ? "py-3 font-medium" : "py-3 text-muted"}
                          >
                            {getCell(row, col.key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {footnote && (
                <p className="text-[10px] text-muted mt-6 leading-relaxed">{footnote}</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-muted hover:text-graphite transition-colors mt-2"
      >
        <Ruler className="h-3.5 w-3.5" strokeWidth={1.5} />
        Таблица размеров
      </button>
      {mounted ? createPortal(modal, document.body) : null}
    </>
  );
}
