"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatPrice } from "@/lib/format";
import { Button } from "@/components/ui/Button";

interface StickyAddToCartProps {
  name: string;
  price: number;
  selectedSize: string | null;
  onAddToCart: () => void;
  disabled: boolean;
}

export function StickyAddToCart({
  name,
  price,
  selectedSize,
  onAddToCart,
  disabled,
}: StickyAddToCartProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-border"
        >
          <div className="container-brand flex items-center justify-between gap-4 py-3 md:py-4">
            <div className="min-w-0 hidden sm:block">
              <p className="text-[11px] uppercase tracking-[0.12em] truncate">{name}</p>
              <p className="text-sm mt-0.5">
                {formatPrice(price)}
                {selectedSize && (
                  <span className="text-muted ml-3 text-[10px] uppercase tracking-wider">
                    · {selectedSize}
                  </span>
                )}
              </p>
            </div>
            <Button
              variant="primary"
              size="md"
              magnetic
              disabled={disabled}
              onClick={onAddToCart}
              className="w-full sm:w-auto sm:min-w-[200px]"
            >
              {selectedSize ? "В корзину" : "Выберите размер"}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
