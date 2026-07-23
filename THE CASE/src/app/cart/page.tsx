"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import { useStore, useHydrated, selectCartTotal, isAtStockLimit } from "@/lib/store";
import { formatPrice } from "@/lib/format";
import { quoteCart, AdmikApiError } from "@/lib/admik";
import { cartToItems } from "@/lib/checkout";
import { Button } from "@/components/ui/Button";
import { FadeIn } from "@/components/ui/Animations";
import { useCheckoutMode } from "@/components/CheckoutModeProvider";

export default function CartPage() {
  const cart = useStore((s) => s.cart);
  const updateQuantity = useStore((s) => s.updateQuantity);
  const removeFromCart = useStore((s) => s.removeFromCart);
  const total = useStore(selectCartTotal);
  const promoCode = useStore((s) => s.promoCode);
  const setPromoCode = useStore((s) => s.setPromoCode);
  const giftWrap = useStore((s) => s.giftWrap);
  const setGiftWrap = useStore((s) => s.setGiftWrap);
  // Режим оформления магазина: показывать ли пункт подарочной упаковки.
  const checkoutMode = useCheckoutMode();
  const hydrated = useHydrated();

  // Промокод в корзине (Мадина: перенести из чекаута). Ввод хранится в store и
  // переносится в чекаут; применённость/скидку подтверждает сервер (quoteCart).
  const [promoInput, setPromoInput] = useState(promoCode);
  const [applying, setApplying] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [discount, setDiscount] = useState(0);

  const applyPromo = async () => {
    const code = promoInput.trim();
    setApplying(true);
    setPromoMsg(null);
    try {
      const q = await quoteCart({ items: cartToItems(cart), promoCode: code || undefined });
      const applied = Boolean(q.promo?.applied);
      setDiscount(Number(q.discountTotal ?? 0));
      setPromoCode(applied ? code : "");
      if (!code) {
        setPromoMsg(null);
      } else if (applied) {
        setPromoMsg({ ok: true, text: `Промокод ${q.promo?.code} применён.` });
      } else {
        setPromoMsg({ ok: false, text: "Промокод недействителен." });
        setDiscount(0);
      }
    } catch (e) {
      setPromoMsg({ ok: false, text: e instanceof AdmikApiError ? e.message : "Не удалось применить промокод." });
    } finally {
      setApplying(false);
    }
  };

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
                      {item.color && (
                        <p className="text-[10px] text-muted mt-1">
                          Цвет: {item.color}
                        </p>
                      )}
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

              {/* Промокод (Мадина: перенести в корзину). Ввод + применение через
                  серверный quoteCart; скидка учитывается в итоге, код едет в чекаут. */}
              <div className="mb-6">
                <label htmlFor="cart-promo" className="label-caps text-muted block mb-3">Промокод</label>
                <div className="flex gap-3">
                  <input
                    id="cart-promo"
                    type="text"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyPromo(); } }}
                    placeholder="Введите промокод"
                    autoCapitalize="characters"
                    className="min-w-0 flex-1 border border-border px-4 py-3 text-sm uppercase tracking-wide focus:border-graphite outline-none transition-colors"
                  />
                  <Button variant="outline" size="md" disabled={applying || (promoInput.trim() === "" && discount === 0)} onClick={applyPromo}>
                    {applying ? "Проверка..." : "Применить"}
                  </Button>
                </div>
                {promoMsg && (
                  <p className={`text-[11px] mt-2 ${promoMsg.ok ? "text-muted" : "text-accent"}`}>{promoMsg.text}</p>
                )}
              </div>

              {/* Подарочная упаковка (правка владельца 2026-07-22 п.5). Пункт
                  показывается, только если услуга включена в настройках магазина
                  — платформа обслуживает магазины и без неё. Флаг живёт в store
                  (как промокод) и едет в заказ на шаге подтверждения. */}
              {checkoutMode.giftWrapEnabled && (
                <label
                  htmlFor="cart-gift-wrap"
                  className="mb-6 flex cursor-pointer items-start gap-3 border border-border p-4 transition-colors hover:border-graphite"
                >
                  <input
                    id="cart-gift-wrap"
                    type="checkbox"
                    checked={giftWrap}
                    onChange={(e) => setGiftWrap(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-graphite"
                  />
                  <span className="text-sm leading-snug">{checkoutMode.giftWrapLabel}</span>
                </label>
              )}

              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Товары</span>
                  <span>{formatPrice(total)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">Скидка по промокоду</span>
                    <span className="text-accent">−{formatPrice(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4 text-sm">
                  <span className="shrink-0 text-muted">Доставка</span>
                  <span className="text-right text-muted">Рассчитывается при оформлении</span>
                </div>
              </div>
              <div className="flex justify-between text-lg border-t border-border pt-4 mb-8">
                <span className="uppercase tracking-[0.1em] text-[11px]">Итого</span>
                <span>{formatPrice(Math.max(0, total - discount))}</span>
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
