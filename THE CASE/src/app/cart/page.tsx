"use client";

import Link from "next/link";
import Image from "next/image";
import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import { useStore, useHydrated, selectCartTotal, isAtStockLimit } from "@/lib/store";
import { formatPrice } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FadeIn } from "@/components/ui/Animations";

export default function CartPage() {
  const cart = useStore((s) => s.cart);
  const updateQuantity = useStore((s) => s.updateQuantity);
  const removeFromCart = useStore((s) => s.removeFromCart);
  const total = useStore(selectCartTotal);
  const hydrated = useHydrated();

  // До завершения регидрации не показываем «Корзина пуста» (иначе мерцает пустотой
  // при наличии сохранённой корзины).
  if (!hydrated) {
    return <div className="page-transition pt-16 md:pt-20 min-h-[60vh]" />;
  }

  if (cart.length === 0) {
    return (
      <div className="page-transition pt-16 md:pt-20 min-h-[60vh] flex items-center justify-center">
        <FadeIn className="text-center px-4">
          <ShoppingBag className="h-12 w-12 mx-auto mb-6 text-muted" strokeWidth={1} />
          <h1 className="heading-md mb-4">Корзина пуста</h1>
          <p className="text-sm text-muted mb-8 max-w-sm mx-auto">
            Добавьте товары из коллекции THE CASE
          </p>
          <Link href="/catalog">
            <Button variant="primary" size="lg" magnetic>
              Перейти в каталог
            </Button>
          </Link>
        </FadeIn>
      </div>
    );
  }

  return (
    <div className="page-transition pt-16 md:pt-20">
      <div className="container-brand py-12 md:py-16">
        <FadeIn>
          <h1 className="heading-lg heading-rule mb-16">Корзина</h1>
        </FadeIn>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 lg:gap-16">
          <div className="lg:col-span-2 space-y-6">
            {cart.map((item) => (
              <FadeIn key={item.variantId}>
                <div className="flex gap-4 md:gap-6 pb-6 border-b border-border">
                  <Link
                    href={`/product/${item.slug}`}
                    className="relative w-24 h-32 md:w-32 md:h-40 bg-surface shrink-0 overflow-hidden"
                  >
                    {item.imageUrl && (
                      <Image
                        src={item.imageUrl}
                        alt={item.name}
                        fill
                        className="object-contain object-center"
                      />
                    )}
                  </Link>

                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <Link href={`/product/${item.slug}`}>
                        <h3 className="text-[11px] uppercase tracking-[0.12em] hover:opacity-60">
                          {item.name}
                        </h3>
                      </Link>
                      {item.size && (
                        <p className="text-[10px] text-muted mt-1">
                          Размер: {item.size}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-4">
                      <div className="inline-flex items-center border border-border">
                        <button
                          onClick={() =>
                            updateQuantity(item.variantId, item.quantity - 1)
                          }
                          className="p-2 hover:bg-surface transition-colors"
                          aria-label="Уменьшить количество"
                        >
                          <Minus className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                        <span className="px-4 text-sm">{item.quantity}</span>
                        <button
                          onClick={() =>
                            updateQuantity(item.variantId, item.quantity + 1)
                          }
                          disabled={isAtStockLimit(item)}
                          className="p-2 hover:bg-surface transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Увеличить количество"
                        >
                          <Plus className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                      </div>

                      <div className="flex items-center gap-4">
                        <p className="text-sm">
                          {formatPrice(item.price * item.quantity)}
                        </p>
                        <button
                          onClick={() => removeFromCart(item.variantId)}
                          className="text-muted hover:text-accent transition-colors"
                          aria-label="Удалить"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>

          <FadeIn delay={0.2}>
            <div className="lg:sticky lg:top-28 bg-surface p-8">
              <h2 className="heading-md mb-6">Итого</h2>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Товары</span>
                  <span>{formatPrice(total)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Доставка</span>
                  <span className="text-muted">Рассчитывается при оформлении</span>
                </div>
              </div>
              <div className="flex justify-between text-lg border-t border-border pt-4 mb-8">
                <span className="uppercase tracking-[0.1em] text-[11px]">Итого</span>
                <span>{formatPrice(total)}</span>
              </div>
              <Link href="/checkout">
                <Button variant="primary" size="lg" magnetic className="w-full">
                  Оформить заказ
                </Button>
              </Link>
              <Link
                href="/catalog"
                className="block text-center mt-4 text-[11px] uppercase tracking-[0.12em] text-muted hover:text-graphite transition-colors"
              >
                Продолжить покупки
              </Link>
            </div>
          </FadeIn>
        </div>
      </div>
    </div>
  );
}
