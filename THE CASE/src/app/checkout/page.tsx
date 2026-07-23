"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
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
  formatDeliveryCost,
  describeQuoteIssues,
  formatRuPhone,
  contactFieldErrors,
  isRussianCountry,
} from "@/lib/checkout";
import { appliedPromoCode, isPromoInSync } from "@/lib/promo";
import { Button } from "@/components/ui/Button";
import { FadeIn } from "@/components/ui/Animations";
import { useCheckoutMode } from "@/components/CheckoutModeProvider";

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, clearCart, addOrder } = useStore();
  const hydrated = useHydrated();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Шаг 2 — доставка СДЭК. Способ: ПВЗ (пункт выдачи) или курьер (на адрес).
  const [deliveryMethod, setDeliveryMethod] = useState<"pvz" | "courier">("pvz");
  const [courierAddress, setCourierAddress] = useState("");
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
  // Промокод: вводится только в корзине, сюда приезжает через store — поля ввода на
  // шаге оплаты нет. Сервер подтверждает применённость/скидку (quote.promo /
  // quote.discountTotal, anti-tamper).
  const promoCode = useStore((s) => s.promoCode);
  // Подарочная упаковка отмечена в корзине — здесь только доносим её до заказа.
  const giftWrap = useStore((s) => s.giftWrap);
  // Режим оформления: работает ли онлайн-оплата у этого магазина (п.7).
  const checkoutMode = useCheckoutMode();

  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  // Правка Ани2 #7: показывать подсветку незаполненных/неверных полей ПОСЛЕ первой
  // попытки перейти «Далее» (иначе кнопка молча неактивна и покупатель не понимает).
  const [showContactErrors, setShowContactErrors] = useState(false);

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
      // Сдвигаем seq и в этой ветке: иначе in-flight запрос (таймер уже сработал,
      // ждём сеть), стартовавший ДО выбора города, по возврату пройдёт проверку
      // seq и переоткроет выпадашку поверх уже выбранного города.
      citiesSeqRef.current++;
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
    // m11: сбрасываем и quote — иначе устаревший quote.delivery.available от прежнего
    // города/ПВЗ держал бы «Уточняется» поверх свежерасчитанной цены нового города.
    setQuote(null);
    setDeliveryEta("");
    setError("");
    setLoading(true);
    try {
      const [points, calc] = await Promise.all([
        cdekPvz({ cityCode: city.code }),
        cdekCalculate({
          to: { city_code: city.code },
          deliveryMode: deliveryMethod === "courier" ? "door" : "pvz",
          items: cartToItems(cart),
        }),
      ]);
      if (seq !== citySeqRef.current) return; // выбран другой город — игнорируем устаревший ответ
      setPickupPoints(points);
      // Правка владельца: по РФ доставка покупателю бесплатна (реальная стоимость
      // СДЭК — в заказе для магазина) → показываем 0 сразу, не сырой тариф. Для
      // СНГ/зарубежа доставка платная → показываем реальный тариф calc.cost.
      // Финальный quote после ПВЗ подтвердит (сервер — источник истины). calc всё
      // равно нужен для срока доставки.
      const isRu = isRussianCountry(city.country);
      setDeliveryCost(isRu ? 0 : calc.cost);
      setDeliveryEta(formatEta(calc.periodMin, calc.periodMax));
    } catch (e) {
      if (seq !== citySeqRef.current) return;
      setPickupPoints([]);
      setError(e instanceof AdmikApiError ? e.message : "Не удалось рассчитать доставку");
    } finally {
      if (seq === citySeqRef.current) setLoading(false);
    }
  };

  // Единый билдер объекта доставки по выбранному способу (ПВЗ/курьер) — чтобы не
  // дублировать (и не рассинхронить) поля в quote/order. Для ПВЗ несёт pvzCode, для
  // курьера — address (адрес на дом). Город/страна общие. pvzOverride — для колбэка
  // выбора ПВЗ, где selectedPickup ещё не применился в стейт.
  const buildDelivery = (pvzOverride?: AdmikCdekPvzDto) => {
    const base = {
      city: selectedCity?.name,
      cityCode: selectedCity?.code,
      country: selectedCity?.country,
    };
    if (deliveryMethod === "courier") {
      return { type: "courier" as const, ...base, address: courierAddress.trim() };
    }
    return { type: "pvz" as const, ...base, pvzCode: (pvzOverride ?? selectedPickup)?.code };
  };

  // Назначение доставки готово: город + (ПВЗ для pickup / адрес для курьера).
  const deliveryReady = Boolean(
    selectedCity && (deliveryMethod === "courier" ? courierAddress.trim() : selectedPickup),
  );

  // Выбор ПВЗ → серверный quote (anti-tamper): показываем на шаге 2 ИМЕННО серверную
  // стоимость доставки (с учётом порога бесплатной доставки), а не сырой тариф СДЭК —
  // иначе шаг 2 покажет ненулевую сумму там, где сервер в итоге посчитает 0.
  const handlePvzSelect = async (pvz: AdmikCdekPvzDto) => {
    setSelectedPickup(pvz);
    setError("");
    try {
      const q = await quoteCart({
        items: cartToItems(cart),
        promoCode: promoCode.trim() || undefined,
        delivery: buildDelivery(pvz),
      });
      setQuote(q);
      setDeliveryCost(Number(q.deliveryTotal)); // серверная доставка (с порогом бесплатной)
    } catch {
      // оставляем предварительную стоимость из cdekCalculate; финальный итог — на шаге 3
    }
  };

  // Переход на шаг 3 — серверный расчёт итога (anti-tamper).
  const goToPayment = async () => {
    if (!deliveryReady) return;
    setError("");
    setLoading(true);
    try {
      const q = await quoteCart({
        items: cartToItems(cart),
        promoCode: promoCode.trim() || undefined,
        delivery: buildDelivery(),
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
    if (!deliveryReady || !quote || !quote.fulfillable) return;
    // Нельзя оформлять, пока доставка не посчитана (явный available === false).
    if (quote.delivery?.available === false) return;
    // Находка 19: код в store (введён в корзине) разошёлся с применённым сервером —
    // например, протух за время между корзиной и оплатой. Показанный итог посчитан по
    // другому коду, поэтому не оформляем «вслепую». Поля ввода здесь нет, снять код
    // можно только в корзине — поэтому объясняем причину, а не молчим (иначе кнопка
    // «Подтвердить заказ» выглядит сломанной).
    if (!isPromoInSync(promoCode, quote.promo)) {
      setError(
        quote.promo?.reason ??
          "Промокод больше недействителен. Вернитесь в корзину и уберите его.",
      );
      return;
    }
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
          delivery: buildDelivery(),
          paymentMethod: mapPaymentMethod(paymentMethod),
          // Источник истины для ОТПРАВКИ = применённый сервером код (по которому
          // посчитан показанный итог), а НЕ сырое значение поля ввода. Так заказ
          // не расходится с тем, что покупатель видел на экране (находка 19).
          promoCode: appliedPromoCode(quote.promo),
          // Просьба об упаковке отмечена в корзине (п.5) — едет отдельным полем
          // заказа, чтобы комплектовщик видел признак, а не искал его в тексте.
          giftWrap,
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
      const method = mapPaymentMethod(paymentMethod);

      // У магазина нет работающей кассы (настройка checkout.onlinePaymentEnabled
      // = false, правка владельца п.7): заказ принят как ЗАЯВКА, эквайринг не
      // трогаем вовсе. Иначе покупателя увело бы на страницу оплаты, которая без
      // ключей падает. Заказ создан и виден в админке — магазин перезвонит.
      if (!checkoutMode.onlinePaymentEnabled) {
        router.push(accountUrl);
        return;
      }

      // Онлайн-эквайринг Т-Банк инициируем ТОЛЬКО для карты/СБП. СДЭК PAY (cdek-pay) —
      // оплата через СДЭК (на ПВЗ/при получении), отдельная онлайн-инициация не нужна →
      // ведём в ЛК (заказ создан, статус «ожидает оплаты»; доплата — кнопкой в ЛК).
      // Раньше (регресс волны 9) ЛЮБОЙ метод безусловно слался на Т-Банк-карту.
      if (method !== "card" && method !== "sbp") {
        router.push(accountUrl);
        return;
      }
      try {
        const pay = await initPayment(created.number, {
          accessToken: created.accessToken,
          returnUrl: `${window.location.origin}${accountUrl}`,
        });
        if (pay?.paymentUrl) {
          window.location.href = pay.paymentUrl;
          return;
        }
        router.push(accountUrl); // init без URL — заказ создан, оплата из ЛК
      } catch {
        // Оплата не запустилась (модуль payments off / сбой) — заказ создан; в ЛК
        // покупатель увидит заказ и кнопку «Оплатить картой» (не молчаливый тупик).
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
  // Доставку не удалось рассчитать только при ЯВНОМ available === false. Если поле
  // отсутствует/undefined (старый контракт) — считаем расчёт доступным (мягкая
  // деградация). Нельзя платить за непосчитанную доставку → блокируем подтверждение.
  const deliveryUnavailable = quote?.delivery?.available === false;

  return (
    <div className="page-transition flush-footer pt-16 md:pt-20 relative">
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
                {(["firstName", "lastName", "email", "phone"] as const).map((key) => {
                  const fieldErrors = contactFieldErrors(form);
                  const invalid = showContactErrors && fieldErrors[key];
                  const errText = {
                    firstName: "Укажите имя",
                    lastName: "",
                    email: "Введите корректный email",
                    phone: "Введите номер полностью (11 цифр)",
                  }[key];
                  return (
                    <div key={key}>
                      <label className="label-caps text-muted block mb-3">
                        {{ firstName: "Имя", lastName: "Фамилия", email: "Email", phone: "Телефон" }[key]}
                      </label>
                      <input
                        type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                        inputMode={key === "phone" ? "numeric" : undefined}
                        placeholder={key === "phone" ? "+7 (___) ___-__-__" : undefined}
                        value={form[key]}
                        aria-invalid={invalid || undefined}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            // Маска телефона (правка Ани2 #8): ≤11 цифр, авто-формат.
                            [key]: key === "phone" ? formatRuPhone(e.target.value) : e.target.value,
                          })
                        }
                        className={`w-full border px-4 py-3 text-sm outline-none transition-colors ${
                          invalid ? "border-red-500 focus:border-red-500" : "border-border focus:border-graphite"
                        }`}
                      />
                      {invalid && errText ? (
                        <p className="mt-1.5 text-xs text-red-600">{errText}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {/* Правка Ани2 #7: кнопка кликабельна всегда; при невалидности не
                  переходит молча, а включает подсветку незаполненных полей. */}
              <Button
                variant="primary"
                size="lg"
                magnetic
                onClick={() => {
                  if (isContactStepValid(form)) setStep(2);
                  else setShowContactErrors(true);
                }}
              >
                Далее
              </Button>
              {showContactErrors && !isContactStepValid(form) ? (
                <p className="mt-2 text-sm text-red-600">
                  Заполните обязательные поля, отмеченные красным.
                </p>
              ) : null}
            </div>
          </FadeIn>
        )}

        {step === 2 && (
          <FadeIn>
            <div className="space-y-6 mt-8">
              {/* Способ доставки (Мадина: добавить курьера). ПВЗ (пункт выдачи) или
                  курьер на адрес. Переключение сбрасывает выбранный ПВЗ/адрес. */}
              <div>
                <label className="label-caps text-muted block mb-3">Способ доставки</label>
                <div className="grid grid-cols-2 gap-3">
                  {([["pvz", "Пункт выдачи"], ["courier", "Курьером"]] as const).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setDeliveryMethod(m);
                        setSelectedPickup(null);
                        setQuote(null);
                        // Стоимость пересчитается: 0 (РФ) сразу, для СНГ — при quote.
                        if (selectedCity) setDeliveryCost(isRussianCountry(selectedCity.country) ? 0 : deliveryCost);
                      }}
                      aria-pressed={deliveryMethod === m}
                      className={`border px-4 py-3 text-sm transition-colors ${deliveryMethod === m ? "border-graphite bg-graphite text-white" : "border-border text-muted hover:border-graphite"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <label className="label-caps text-muted block mb-3">Город</label>
                <input type="text" value={cityQuery} onChange={(e) => {
                  setCityQuery(e.target.value);
                  // Правка города после выбора инвалидирует выбранный город И всё,
                  // что от него зависит: список ПВЗ, выбранный пункт, стоимость/срок.
                  // Иначе на экране остаются ПВЗ/цена от прежнего города.
                  setSelectedCity(null);
                  setSelectedPickup(null);
                  setPickupPoints([]);
                  setDeliveryCost(null);
                  setQuote(null); // m11: стоимость/доступность от прежнего города — недействительны
                  setDeliveryEta("");
                }} placeholder="Начните вводить..."
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
                  {/* m11: «Бесплатно» только если доставка ДОСТУПНА; иначе «Уточняется»
                      (как шаг 3) — не показываем «Бесплатно» за непосчитанную доставку. */}
                  <span>{formatDeliveryCost(deliveryCost, !deliveryUnavailable, formatPrice)}</span>
                </div>
              )}
              {/* ПВЗ: компактный дропдаун (только для способа «Пункт выдачи»). */}
              {deliveryMethod === "pvz" && pickupPoints.length > 0 && (
                <PvzSelect points={pickupPoints} selected={selectedPickup} onSelect={handlePvzSelect} />
              )}
              {/* Курьер: поле адреса доставки (город уже выбран выше). */}
              {deliveryMethod === "courier" && selectedCity && (
                <div>
                  <label htmlFor="courier-address" className="label-caps text-muted block mb-3">Адрес доставки</label>
                  <input
                    id="courier-address"
                    type="text"
                    value={courierAddress}
                    onChange={(e) => { setCourierAddress(e.target.value); setQuote(null); }}
                    placeholder="Улица, дом, квартира"
                    className="w-full border border-border px-4 py-3 text-sm focus:border-graphite outline-none transition-colors"
                  />
                </div>
              )}
              {error && <p className="text-sm text-accent">{error}</p>}
              <div className="flex gap-4">
                <Button variant="outline" size="md" onClick={() => setStep(1)}>Назад</Button>
                <Button variant="primary" size="lg" magnetic disabled={loading || !isDeliveryStepValid(selectedCity?.code ?? null, selectedPickup?.code ?? null, deliveryMethod, courierAddress)} onClick={goToPayment}>
                  {loading ? "Расчёт..." : "Далее"}
                </Button>
              </div>
            </div>
          </FadeIn>
        )}

        {step === 3 && (
          <FadeIn>
            <div className="space-y-6 mt-8">
              {/* Оплата: либо выбор способа, либо честная заглушка-заявка (п.7).
                  Выбор способа при выключенной кассе прятать ОБЯЗАТЕЛЬНО — иначе
                  покупатель выбирает «Банковская карта» и ждёт списания, которого
                  не будет. Способ заказа при этом остаётся дефолтным: владелец
                  видит его в админке и уточняет по телефону. */}
              {checkoutMode.onlinePaymentEnabled ? (
                <OptionGroup title="Оплата" options={PAYMENT_METHODS} selected={paymentMethod}
                  onSelect={(m) => setPaymentMethod(m.id)} render={(m) => m.name} sub={(m) => m.description} />
              ) : (
                <div>
                  <p className="label-caps text-muted mb-3">Оплата</p>
                  <div className="border border-border bg-surface p-5">
                    <p className="text-sm leading-relaxed">{checkoutMode.paymentDisabledNotice}</p>
                  </div>
                </div>
              )}

              <div className="bg-surface p-6 space-y-3">
                <Row label="Товары" value={formatPrice(Number(quote?.itemsTotal ?? 0))} />
                {Number(quote?.discountTotal ?? 0) > 0 && (
                  <Row label="Скидка" value={`−${formatPrice(Number(quote?.discountTotal ?? 0))}`} />
                )}
                <Row
                  label="Доставка"
                  value={deliveryUnavailable ? "Уточняется" : formatPrice(Number(quote?.deliveryTotal ?? 0))}
                />
                <Row label="Итого" value={formatPrice(Number(quote?.grandTotal ?? 0))} bold />
              </div>
              {deliveryUnavailable && (
                <p className="text-sm text-accent">
                  Стоимость доставки уточняется. Оформление будет доступно после расчёта.
                </p>
              )}
              {(!fulfillable || hasIssues) &&
                (hasIssues ? (
                  // C25: конкретные позиции + причины недоступности (вместо generic
                  // строки) — покупатель видит, ЧТО именно убрать/обновить в корзине.
                  <div className="text-sm text-accent">
                    <p>Некоторые позиции недоступны к заказу:</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {describeQuoteIssues(quote?.issues ?? [], cart).map((it, i) => (
                        <li key={i}>
                          {it.name} — {it.reason}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2">Обновите корзину и попробуйте снова.</p>
                  </div>
                ) : (
                  <p className="text-sm text-accent">
                    Некоторые позиции недоступны к заказу. Обновите корзину и попробуйте снова.
                  </p>
                ))}
              {error && <p className="text-sm text-accent">{error}</p>}
              <div className="flex gap-4">
                <Button variant="outline" size="md" onClick={() => setStep(2)}>Назад</Button>
                <Button variant="primary" size="lg" magnetic disabled={loading || !fulfillable || deliveryUnavailable} onClick={handleSubmit} className="flex-1">
                  {loading
                    ? "Оформление..."
                    : checkoutMode.onlinePaymentEnabled
                      ? "Подтвердить заказ"
                      : "Отправить заявку"}
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

/**
 * Компактный выбор ПВЗ (правка владельца: «как у carre russe»). Раньше все ПВЗ
 * рендерились столбиком карточек → на телефоне приходилось листать до самого низа,
 * чтобы дойти до «Далее». Теперь — свёрнутая строка с выбранным пунктом; клик
 * разворачивает скроллящийся (max-h) список, выбор сворачивает обратно.
 */
function PvzSelect({
  points, selected, onSelect,
}: {
  points: AdmikCdekPvzDto[];
  selected: AdmikCdekPvzDto | null;
  onSelect: (opt: AdmikCdekPvzDto) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className="label-caps text-muted mb-3">Пункт выдачи</p>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between border border-border px-4 py-3 text-left text-sm focus:border-graphite outline-none hover:border-graphite transition-colors"
          aria-expanded={open}
        >
          <span className={selected ? "text-graphite" : "text-muted"}>
            {selected ? (
              <><span className="block">{selected.name}</span><span className="block text-[10px] text-muted mt-0.5">{selected.address}</span></>
            ) : (
              `Выберите пункт выдачи (${points.length})`
            )}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.5} />
        </button>
        {open && (
          <div className="absolute z-20 w-full bg-white border border-border mt-1 max-h-64 overflow-y-auto shadow-lg [-webkit-overflow-scrolling:touch]">
            {points.map((pvz) => (
              <button
                key={pvz.code}
                type="button"
                onClick={() => { onSelect(pvz); setOpen(false); }}
                className={`w-full text-left px-4 py-3 text-sm hover:bg-surface transition-colors ${selected?.code === pvz.code ? "bg-surface" : ""}`}
              >
                <span className="block text-graphite">{pvz.name}</span>
                <span className="block text-[10px] text-muted mt-0.5">{pvz.address}</span>
              </button>
            ))}
          </div>
        )}
      </div>
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
