"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Ruler } from "lucide-react";

const SIZE_TABLE = {
  women: [
    { size: "XS", chest: "80–84", waist: "60–64", hips: "86–90" },
    { size: "S", chest: "84–88", waist: "64–68", hips: "90–94" },
    { size: "M", chest: "88–92", waist: "68–72", hips: "94–98" },
    { size: "L", chest: "92–96", waist: "72–76", hips: "98–102" },
    { size: "XL", chest: "96–100", waist: "76–80", hips: "102–106" },
  ],
  men: [
    { size: "S", chest: "88–92", waist: "76–80", hips: "92–96" },
    { size: "M", chest: "92–96", waist: "80–84", hips: "96–100" },
    { size: "L", chest: "96–100", waist: "84–88", hips: "100–104" },
    { size: "XL", chest: "100–104", waist: "88–92", hips: "104–108" },
    { size: "XXL", chest: "104–108", waist: "92–96", hips: "108–112" },
  ],
};

export function SizeGuide({ gender }: { gender: "women" | "men" | "unisex" }) {
  const [open, setOpen] = useState(false);
  const table = gender === "men" ? SIZE_TABLE.men : SIZE_TABLE.women;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-muted hover:text-graphite transition-colors mt-2"
      >
        <Ruler className="h-3.5 w-3.5" strokeWidth={1.5} />
        Таблица размеров
      </button>

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
                  <h3 className="heading-md">Size Guide</h3>
                  <p className="text-[10px] text-muted mt-2 tracking-wide">Все измерения в см</p>
                </div>
                <button onClick={() => setOpen(false)} aria-label="Закрыть">
                  <X className="h-5 w-5" strokeWidth={1.5} />
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {["Размер", "Грудь", "Талия", "Бёдра"].map((h) => (
                        <th key={h} className="text-left py-3 text-[10px] uppercase tracking-[0.12em] text-muted font-normal">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.map((row) => (
                      <tr key={row.size} className="border-b border-border/50">
                        <td className="py-3 font-medium">{row.size}</td>
                        <td className="py-3 text-muted">{row.chest}</td>
                        <td className="py-3 text-muted">{row.waist}</td>
                        <td className="py-3 text-muted">{row.hips}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-[10px] text-muted mt-6 leading-relaxed">
                Допустимое отклонение ±2 см. Для точного подбора сравните с вашей любимой одеждой аналогичного типа.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
