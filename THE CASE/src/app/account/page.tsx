"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Package } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { getOrder, initPayment, AdmikApiError, type AdmikOrderPublicDto } from "@/lib/admik";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/Button";
import { FadeIn } from "@/components/ui/Animations";
import { IMAGES } from "@/lib/images";

const STATUS_LABELS: Record<string, string> = {
  // статусы заказа
  new: "Новый",
  awaiting_payment: "Ожидает оплаты",
  paid: "Оплачен",
  packed: "Собран",
  processing: "В обработке",
  confirmed: "Подтверждён",
  shipped: "Отправлен",
  delivered: "Доставлен",
  completed: "Завершён",
  cancelled: "Отменён",
  refunded: "Возврат оформлен",
  // статусы оплаты (statusLabel общий для заказа/оплаты/доставки)
  pending: "Ожидает оплаты",
  authorized: "Оплата захолдирована",
  failed: "Оплата не прошла",
  // статусы доставки
  registered: "Накладная создана",
  in_transit: "В пути",
  returned: "Возвращена",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status.toLowerCase()] ?? status;
}

/**
 * Можно ли доплатить заказ онлайн: не оплачен (pending/failed/unset) и метод —
 * карта/СБП (Т-Банк-эквайринг). `failed` ВКЛЮЧЁН: после отказа/таймаута оплаты
 * (Т-Банк REJECTED/CANCELED/DEADLINE_EXPIRED → payment_status='failed') покупатель
 * должен мочь повторить оплату из ЛК — иначе тупик и потерянная продажа. Бэкенд
 * init это допускает (любой статус кроме paid/refunded), машина: failed→pending.
 */
function isPayable(order: AdmikOrderPublicDto): boolean {
  const st = order.paymentStatus?.toLowerCase();
  const m = order.paymentMethod?.toLowerCase();
  return (st === "pending" || st === "failed" || st === "unset" || !st) && (m === "card" || m === "sbp");
}

/** Карточка заказа: статусы, позиции, суммы, трек + «Оплатить» для неоплаченного online-заказа. */
function OrderCard({
  order,
  payProof,
}: {
  order: AdmikOrderPublicDto;
  payProof?: { token?: string; email?: string };
}) {
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const canPay = isPayable(order) && Boolean(payProof?.token || payProof?.email);

  const handlePay = async () => {
    if (!payProof) return;
    setPaying(true);
    setPayError("");
    try {
      const ret = `${window.location.origin}/account?order=${encodeURIComponent(order.number)}${
        payProof.token ? `&token=${encodeURIComponent(payProof.token)}` : ""
      }`;
      // initPayment ждёт accessToken|email (НЕ token) — маппим явно, иначе на
      // token-пути авторизация заказа не уходит и init падает 404.
      const pay = await initPayment(
        order.number,
        { accessToken: payProof.token, email: payProof.email, returnUrl: ret },
      );
      if (pay?.paymentUrl) {
        window.location.href = pay.paymentUrl;
        return;
      }
      setPayError("Не удалось начать оплату. Попробуйте позже.");
    } catch (e) {
      setPayError(e instanceof AdmikApiError ? e.message : "Не удалось начать оплату.");
    }
    setPaying(false);
  };

  return (
    <div className="border border-border p-6 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em]">#{order.number}</p>
          <p className="text-[10px] text-muted mt-1">{statusLabel(order.status)}</p>
        </div>
        <p className="text-sm">{formatPrice(Number(order.grandTotal))}</p>
      </div>
      <div className="space-y-2 border-t border-border pt-4">
        {order.items.map((it, i) => (
          <div key={`${it.sku}-${i}`} className="flex justify-between text-sm">
            <span className="text-muted">
              {it.name}
              {it.qty > 1 ? ` × ${it.qty}` : ""}
            </span>
            <span>{formatPrice(Number(it.lineTotal))}</span>
          </div>
        ))}
      </div>
      <div className="space-y-1 border-t border-border pt-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Товары</span>
          <span>{formatPrice(Number(order.itemsTotal))}</span>
        </div>
        {Number(order.discountTotal) > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted">Скидка</span>
            <span>−{formatPrice(Number(order.discountTotal))}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-muted">Доставка</span>
          <span>{formatPrice(Number(order.deliveryTotal))}</span>
        </div>
      </div>
      <div className="border-t border-border pt-4 text-[10px] text-muted space-y-1">
        <p>Оплата: {statusLabel(order.paymentStatus)}</p>
        <p>Доставка: {statusLabel(order.deliveryStatus)}</p>
        {order.delivery.city && <p>Город: {order.delivery.city}</p>}
        {order.delivery.track && <p>Трек СДЭК: {order.delivery.track}</p>}
      </div>
      {canPay && (
        <div className="border-t border-border pt-4">
          <Button variant="primary" size="md" onClick={handlePay} disabled={paying} className="w-full">
            {paying ? "Переход к оплате..." : "Оплатить картой"}
          </Button>
          {payError && <p className="text-sm text-accent mt-2">{payError}</p>}
        </div>
      )}
    </div>
  );
}

/** Локальный заказ store → подгружает статус через getOrder(number, {token}). */
function StoredOrderCard({ number, token }: { number: string; token: string }) {
  const [order, setOrder] = useState<AdmikOrderPublicDto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getOrder(number, { token })
      .then((o) => {
        if (active) {
          if (o) setOrder(o);
          else setFailed(true);
        }
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [number, token]);

  if (order) return <OrderCard order={order} payProof={{ token }} />;
  return (
    <div className="border border-border p-6">
      <p className="text-[11px] uppercase tracking-[0.12em]">#{number}</p>
      <p className="text-[10px] text-muted mt-1">
        {failed ? "Не удалось загрузить статус" : "Загрузка..."}
      </p>
    </div>
  );
}

function AccountContent() {
  const searchParams = useSearchParams();
  const orderParam = searchParams.get("order");
  const tokenParam = searchParams.get("token");
  const orders = useStore((s) => s.orders);

  const [hydrated, setHydrated] = useState(false);
  const [linkedOrder, setLinkedOrder] = useState<AdmikOrderPublicDto | null>(null);
  const [linkedError, setLinkedError] = useState("");

  // Поиск заказа по номеру + email.
  const [lookupForm, setLookupForm] = useState({ number: "", email: "" });
  const [lookupOrder, setLookupOrder] = useState<AdmikOrderPublicDto | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);

  // Persisted-store гидрируется глобально в Providers (skipHydration: true);
  // флажок гасит SSR/CSR-расхождение при чтении orders.
  useEffect(() => {
    setHydrated(true);
  }, []);

  // ?order=&token= → карточка заказа из трекинга.
  useEffect(() => {
    if (!orderParam || !tokenParam) return;
    setLinkedError("");
    getOrder(orderParam, { token: tokenParam })
      .then((o) => {
        if (o) setLinkedOrder(o);
        else setLinkedError("Заказ не найден или ссылка недействительна");
      })
      .catch((e) =>
        setLinkedError(e instanceof AdmikApiError ? e.message : "Не удалось загрузить заказ"),
      );
  }, [orderParam, tokenParam]);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError("");
    setLookupOrder(null);
    setLookupLoading(true);
    try {
      const o = await getOrder(lookupForm.number.trim(), { email: lookupForm.email.trim() });
      if (o) setLookupOrder(o);
      else setLookupError("Заказ не найден. Проверьте номер и email.");
    } catch (err) {
      setLookupError(err instanceof AdmikApiError ? err.message : "Не удалось найти заказ");
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="page-transition pt-16 md:pt-20 relative min-h-screen">
      <div className="absolute inset-0 bg-cover bg-center opacity-[0.04] pointer-events-none" style={{ backgroundImage: `url(${IMAGES.checkout.bg})` }} />
      <div className="container-brand py-10 md:py-16 max-w-4xl relative z-10">
        {/* Отмена/неудача оплаты: заказ создан, но не оплачен — честно сообщаем и
            направляем к кнопке «Оплатить» в карточке ниже (не выдаём за успех). */}
        {(searchParams.get("payment") === "cancelled" || searchParams.get("payment") === "failed") && (
          <FadeIn>
            <div className="border border-accent/40 bg-accent/5 p-6 mb-8">
              <p className="text-[10px] uppercase tracking-[0.15em] text-accent mb-2">Оплата не завершена</p>
              <p className="text-sm">Заказ создан, но не оплачен. Вы можете оплатить его ниже.</p>
            </div>
          </FadeIn>
        )}

        {/* Баннер «оформлен/оплачено» — когда заказ реально загрузился (карточка ниже)
            И оплата не отменена/не провалена. */}
        {linkedOrder && searchParams.get("payment") !== "cancelled" && searchParams.get("payment") !== "failed" && (
          <FadeIn>
            <div className="bg-surface border border-border p-6 mb-8">
              <p className="text-[10px] uppercase tracking-[0.15em] text-accent mb-2">
                {searchParams.get("paid") ? "Оплата получена" : "Заказ оформлен"}
              </p>
              <p className="text-sm">Заказ #{linkedOrder.number} — статус и трекинг ниже.</p>
            </div>
          </FadeIn>
        )}

        {/* Нейтральное подтверждение оплаты, когда заказ НЕ загружен автоматически
            (доплата по email — token в URL нет): иначе покупатель решит, что оплата
            не прошла. Направляем к форме поиска заказа ниже. */}
        {searchParams.get("paid") && !linkedOrder &&
          searchParams.get("payment") !== "cancelled" && searchParams.get("payment") !== "failed" && (
            <FadeIn>
              <div className="bg-surface border border-border p-6 mb-8">
                <p className="text-[10px] uppercase tracking-[0.15em] text-accent mb-2">Оплата получена</p>
                <p className="text-sm">Заказ оплачен. Найдите его по номеру и email ниже, чтобы увидеть статус.</p>
              </div>
            </FadeIn>
          )}

        <FadeIn>
          <h1 className="heading-lg heading-rule mb-10">Мои заказы</h1>
        </FadeIn>

        {/* Карточка заказа по ссылке трекинга (?order=&token=). */}
        {linkedOrder && (
          <FadeIn>
            <div className="mb-8">
              <OrderCard order={linkedOrder} payProof={{ token: tokenParam ?? undefined }} />
            </div>
          </FadeIn>
        )}
        {linkedError && <p className="text-sm text-accent mb-8">{linkedError}</p>}

        {/* Локально сохранённые заказы (с подгрузкой статуса). */}
        {hydrated && orders.length > 0 && (
          <div className="space-y-4 mb-10">
            {orders
              .filter((o) => !(linkedOrder && o.number === orderParam))
              .map((o) => (
                <StoredOrderCard key={o.number} number={o.number} token={o.accessToken} />
              ))}
          </div>
        )}

        {hydrated && orders.length === 0 && !linkedOrder && !orderParam && (
          <div className="text-center py-12">
            <Package className="h-10 w-10 mx-auto mb-4 text-muted" strokeWidth={1} />
            <p className="text-sm text-muted">Заказов на этом устройстве пока нет</p>
          </div>
        )}

        {/* Поиск заказа по номеру + email. */}
        <FadeIn>
          <div className="border-t border-border pt-10 mt-4">
            <h2 className="heading-md mb-6">Найти заказ</h2>
            <form onSubmit={handleLookup} className="space-y-4 max-w-md">
              <input
                type="text"
                required
                placeholder="Номер заказа"
                value={lookupForm.number}
                onChange={(e) => setLookupForm({ ...lookupForm, number: e.target.value })}
                className="w-full border border-border px-4 py-3 text-sm focus:border-graphite outline-none"
              />
              <input
                type="email"
                required
                placeholder="Email"
                value={lookupForm.email}
                onChange={(e) => setLookupForm({ ...lookupForm, email: e.target.value })}
                className="w-full border border-border px-4 py-3 text-sm focus:border-graphite outline-none"
              />
              {lookupError && <p className="text-sm text-accent">{lookupError}</p>}
              <Button variant="primary" size="lg" magnetic type="submit" disabled={lookupLoading}>
                {lookupLoading ? "Поиск..." : "Найти заказ"}
              </Button>
            </form>
            {lookupOrder && (
              <div className="mt-8 max-w-md">
                <OrderCard order={lookupOrder} payProof={{ email: lookupForm.email.trim() }} />
              </div>
            )}
          </div>
        </FadeIn>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return <Suspense fallback={null}><AccountContent /></Suspense>;
}
