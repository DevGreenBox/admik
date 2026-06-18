"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useStore, useHydrated } from "@/lib/store";
import { formatPrice } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/payment";
import {
  cdekCities,
  cdekPvz,
  cdekCalculate,
  quoteCart,
  createOrder,
  initPayment,
  mapPaymentMethod,
  AdmikApiError,
  type AdmikCdekCityDto,
  type AdmikCdekPvzDto,
  type AdmikQuoteDto,
} from "@/lib/admik";
import {
  cartToItems,
  formatEta,
  fullName,
  isContactStepValid,
  isDeliveryStepValid,
} from "@/lib/checkout";
import { Button } from "@/components/ui/Button";
import { FadeIn } from "@/components/ui/Animations";

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, clearCart, addOrder } = useStore();
  const hydrated = useHydrated();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Шаг 2 — доставка СДЭК (ПВЗ).
  const [cityQuery, setCityQuery] = useState("");
  const [cities, setCities] = useState<AdmikCdekCityDto[]>([]);
  const [selectedCity, setSelectedCity] = useState<AdmikCdekCityDto | null>(null);
  const [pickupPoints, setPickupPoints] = useState<AdmikCdekPvzDto[]>([]);
  const [selectedPickup, setSelectedPickup] = useState<AdmikCdekPvzDto | null>(null);
  const [deliveryCost, setDeliveryCost] = useState<number | null>(null);
  const [deliveryEta, setDeliveryEta] = useState("");

  // Шаг 3 — оплата + серверный итог (quote).
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]?.id ?? "card");
  const [quote, setQuote] = useState<AdmikQuoteDto | null>(null);

  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });

  // Idempotency-Key — один на сессию оформления (повтор не плодит заказы).
  const idempotencyKey = useRef<string>("");
  if (!idempotencyKey.current) {
    idempotencyKey.current =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // Гард завершённого оформления: после успешного заказа clearCart() опустошает
  // корзину, и эффект-редирект ниже иначе перебил бы переход на /account, выкинув
  // покупателя на пустой /cart (теряя подтверждение и токен трекинга).
  const submittedRef = useRef(false);

  // Редирект на /cart ТОЛЬКО после регидрации хранилища и НЕ после оформления:
  // иначе на жёсткой загрузке /checkout корзина ещё пуста (skipHydration) и
  // покупателя ошибочно выкидывало; а после заказа — перебивало /account.
  useEffect(() => {
    if (hydrated && cart.length === 0 && !submittedRef.current) router.push("/cart");
  }, [hydrated, cart, router]);

  // Автокомплит города: debounce 300мс → cdekCities. Seq-токен: применяем только
  // ответ ПОСЛЕДНЕГО запроса (иначе медленный in-flight ответ мог перезаписать
  // список и заново открыть выпадашку уже после выбора города).
  const citiesSeqRef = useRef(0);
  useEffect(() => {
    if (cityQuery.length < 2 || selectedCity?.name === cityQuery) {
      setCities([]);
      return;
    }
    const seq = ++citiesSeqRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await cdekCities(cityQuery);
        if (seq === citiesSeqRef.current) setCities(res);
      } catch {
        if (seq === citiesSeqRef.current) setCities([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [cityQuery, selectedCity]);

  // Токен последовательности: при быстром переключении городов применяем только
  // результаты ПОСЛЕДНЕГО выбора (иначе ответ по предыдущему городу мог перезаписать
  // ПВЗ/стоимость уже выбранного — рассинхрон city↔pvzCode).
  const citySeqRef = useRef(0);
  const handleCitySelect = async (city: AdmikCdekCityDto) => {
    const seq = ++citySeqRef.current;
    setSelectedCity(city);
    setCityQuery(city.name);
    setCities([]);
    setSelectedPickup(null);
    setDeliveryCost(null);
    setDeliveryEta("");
    setError("");
    setLoading(true);
    try {
      const [points, calc] = await Promise.all([
        cdekPvz({ cityCode: city.code }),
        cdekCalculate({
          to: { city_code: city.code },
          deliveryMode: "pvz",
          items: cartToItems(cart),
        }),
      ]);
      if (seq !== citySeqRef.current) return; // выбран другой город — игнорируем устаревший ответ
      setPickupPoints(points);
      setDeliveryCost(calc.cost);
      setDeliveryEta(formatEta(calc.periodMin, calc.periodMax));
    } catch (e) {
      if (seq !== citySeqRef.current) return;
      setPickupPoints([]);
      setError(e instanceof AdmikApiError ? e.message : "Не удалось рассчитать доставку");
    } finally {
      if (seq === citySeqRef.current) setLoading(false);
    }
  };

  // Выбор ПВЗ → серверный quote (anti-tamper): показываем на шаге 2 ИМЕННО серверную
  // стоимость доставки (с учётом порога бесплатной доставки), а не сырой тариф СДЭК —
  // иначе шаг 2 покажет ненулевую сумму там, где сервер в итоге посчитает 0.
  const handlePvzSelect = async (pvz: AdmikCdekPvzDto) => {
    setSelectedPickup(pvz);
    setError("");
    try {
      const q = await quoteCart({
        items: cartToItems(cart),
        delivery: { type: "pvz", city: selectedCity!.name, cityCode: selectedCity!.code, pvzCode: pvz.code },
      });
      setQuote(q);
      setDeliveryCost(Number(q.deliveryTotal)); // серверная доставка (с порогом бесплатной)
    } catch {
      // оставляем предварительную стоимость из cdekCalculate; финальный итог — на шаге 3
    }
  };

  // Переход на шаг 3 — серверный расчёт итога (anti-tamper).
  const goToPayment = async () => {
    if (!selectedCity || !selectedPickup) return;
    setError("");
    setLoading(true);
    try {
      const q = await quoteCart({
        items: cartToItems(cart),
        delivery: { type: "pvz", city: selectedCity.name, cityCode: selectedCity.code, pvzCode: selectedPickup.code },
      });
      setQuote(q);
      setStep(3);
    } catch (e) {
      setError(e instanceof AdmikApiError ? e.message : "Не удалось рассчитать заказ");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedCity || !selectedPickup || !quote || !quote.fulfillable) return;
    setError("");
    setLoading(true);
    try {
      const created = await createOrder(
        {
          items: cartToItems(cart),
          customer: {
            name: fullName(form),
            email: form.email,
            phone: form.phone,
          },
          delivery: { type: "pvz", city: selectedCity.name, cityCode: selectedCity.code, pvzCode: selectedPickup.code },
          paymentMethod: mapPaymentMethod(paymentMethod),
        },
        { idempotencyKey: idempotencyKey.current },
      );
      addOrder({
        number: created.number,
        accessToken: created.accessToken,
        createdAt: new Date().toISOString(),
      });
      // Помечаем оформление завершённым ДО clearCart(), чтобы эффект-редирект на
      // /cart не сработал на опустошённой корзине и не перебил переход дальше.
      submittedRef.current = true;
      clearCart();

      const accountUrl = `/account?order=${encodeURIComponent(created.number)}&token=${encodeURIComponent(created.accessToken)}`;

      // ОНЛАЙН-ОПЛАТА: инициируем платёж и ведём покупателя на платёжный шлюз
      // (боевой Т-Банк — реальная форма; mock — demo-страница). Без этого заказ
      // оставался бы «Ожидает оплаты» без способа заплатить (был тупик). Если оплата
      // недоступна (модуль payments выключен / сбой init) — заказ создан, ведём в ЛК.
      try {
        const pay = await initPayment(created.number, {
          accessToken: created.accessToken,
          returnUrl: `${window.location.origin}${accountUrl}`,
        });
        window.location.href = pay.paymentUrl;
        return;
      } catch {
        router.push(accountUrl);
      }
    } catch (e) {
      // 409 нет остатка / 422 невалидно — показываем сообщение бэкенда, не падаем.
      setError(e instanceof AdmikApiError ? e.message : "Не удалось оформить заказ");
      setLoading(false);
    }
  };

  // До завершения регидрации не рендерим/не редиректим (корзина ещё не восстановлена).
  if (!hydrated) return null;
  if (cart.length === 0) return null;

  const fulfillable = quote?.fulfillable ?? false;
  const hasIssues = (quote?.issues?.length ?? 0) > 0;

  return (
    <div className="page-transition pt-16 md:pt-20 relative min-h-screen">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-[0.04] pointer-events-none"
        style={{ backgroundImage: "url(/images/checkout/workspace.webp)" }}
      />
      <div className="relative z-10">
      <div className="container-brand py-10 md:py-16 max-w-3xl">
        <FadeIn>
          <h1 className="heading-lg heading-rule mb-12">Оформление</h1>
          <StepIndicator step={step} />
        </FadeIn>

        {step === 1 && (
          <FadeIn>
            <div className="space-y-5 mt-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(["firstName", "lastName", "email", "phone"] as const).map((key) => (
                  <div key={key}>
                    <label className="label-caps text-muted block mb-3">
                      {{ firstName: "Имя", lastName: "Фамилия", email: "Email", phone: "Телефон" }[key]}
                    </label>
                    <input
                      type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      className="w-full border border-border px-4 py-3 text-sm focus:border-graphite outline-none transition-colors"
                    />
                  </div>
                ))}
              </div>
              <Button variant="primary" size="lg" magnetic disabled={!isContactStepValid(form)} onClick={() => setStep(2)}>
                Далее
              </Button>
            </div>
          </FadeIn>
        )}

        {step === 2 && (
          <FadeIn>
            <div className="space-y-6 mt-8">
              <div className="relative">
                <label className="label-caps text-muted block mb-3">Город</label>
                <input type="text" value={cityQuery} onChange={(e) => { setCityQuery(e.target.value); setSelectedCity(null); }} placeholder="Начните вводить..."
                  className="w-full border border-border px-4 py-3 text-sm focus:border-graphite outline-none" />
                {cities.length > 0 && (
                  <div className="absolute z-10 w-full bg-white border border-border mt-1 max-h-48 overflow-y-auto shadow-lg">
                    {cities.map((city) => (
                      <button key={`${city.code}`} onClick={() => handleCitySelect(city)}
                        className="w-full text-left px-4 py-3 text-sm hover:bg-surface">{city.name}, {city.region}</button>
                    ))}
                  </div>
                )}
              </div>
              {loading && <div className="space-y-3"><div className="skeleton h-12 w-full" /><div className="skeleton h-12 w-full" /></div>}
              {selectedCity && deliveryCost !== null && (
                <div className="bg-surface p-4 flex justify-between text-sm">
                  <span className="text-muted">Доставка СДЭК{deliveryEta ? ` · ${deliveryEta}` : ""}</span>
                  <span>{deliveryCost === 0 ? "Бесплатно" : formatPrice(deliveryCost)}</span>
                </div>
              )}
              {pickupPoints.length > 0 && (
                <OptionGroup title="Пункт выдачи" options={pickupPoints} selected={selectedPickup?.code}
                  onSelect={handlePvzSelect}
                  render={(opt) => opt.name} sub={(opt) => opt.address} />
              )}
              {error && <p className="text-sm text-accent">{error}</p>}
              <div className="flex gap-4">
                <Button variant="outline" size="md" onClick={() => setStep(1)}>Назад</Button>
                <Button variant="primary" size="lg" magnetic disabled={loading || !isDeliveryStepValid(selectedCity?.code ?? null, selectedPickup?.code ?? null)} onClick={goToPayment}>
                  {loading ? "Расчёт..." : "Далее"}
                </Button>
              </div>
            </div>
          </FadeIn>
        )}

        {step === 3 && (
          <FadeIn>
            <div className="space-y-6 mt-8">
              <OptionGroup title="Оплата" options={PAYMENT_METHODS} selected={paymentMethod}
                onSelect={(m) => setPaymentMethod(m.id)} render={(m) => m.name} sub={(m) => m.description} />
              <div className="bg-surface p-6 space-y-3">
                <Row label="Товары" value={formatPrice(Number(quote?.itemsTotal ?? 0))} />
                {Number(quote?.discountTotal ?? 0) > 0 && (
                  <Row label="Скидка" value={`−${formatPrice(Number(quote?.discountTotal ?? 0))}`} />
                )}
                <Row label="Доставка" value={formatPrice(Number(quote?.deliveryTotal ?? 0))} />
                <Row label="Итого" value={formatPrice(Number(quote?.grandTotal ?? 0))} bold />
              </div>
              {(!fulfillable || hasIssues) && (
                <p className="text-sm text-accent">
                  Некоторые позиции недоступны к заказу. Обновите корзину и попробуйте снова.
                </p>
              )}
              {error && <p className="text-sm text-accent">{error}</p>}
              <div className="flex gap-4">
                <Button variant="outline" size="md" onClick={() => setStep(2)}>Назад</Button>
                <Button variant="primary" size="lg" magnetic disabled={loading || !fulfillable} onClick={handleSubmit} className="flex-1">
                  {loading ? "Оформление..." : "Подтвердить заказ"}
                </Button>
              </div>
            </div>
          </FadeIn>
        )}
      </div>
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="flex gap-6">
      {["Контакты", "Доставка", "Оплата"].map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span className={`w-6 h-6 flex items-center justify-center text-[10px] border ${step > i ? "border-graphite bg-graphite text-white" : "border-border text-muted"}`}>{i + 1}</span>
          <span className="label-caps text-muted hidden sm:inline">{label}</span>
        </div>
      ))}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${bold ? "text-base border-t border-border pt-3" : ""}`}>
      <span className={bold ? "" : "text-muted"}>{label}</span><span>{value}</span>
    </div>
  );
}

function OptionGroup<T extends { id?: string; code?: string }>({
  title, options, selected, onSelect, render, sub,
}: {
  title: string; options: T[]; selected?: string;
  onSelect: (opt: T) => void;
  render: (opt: T) => React.ReactNode;
  sub?: (opt: T) => string;
}) {
  return (
    <div>
      <p className="label-caps text-muted mb-4">{title}</p>
      <div className="space-y-2">
        {options.map((opt) => {
          const id = ("id" in opt ? opt.id : opt.code) as string;
          return (
            <button key={id} onClick={() => onSelect(opt)}
              className={`w-full text-left p-4 border transition-colors ${selected === id ? "border-graphite bg-surface" : "border-border hover:border-graphite"}`}>
              <div className="flex justify-between text-sm">{render(opt)}</div>
              {sub && <p className="text-[10px] text-muted mt-1">{sub(opt)}</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
