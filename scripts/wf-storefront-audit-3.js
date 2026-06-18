export const meta = {
  name: 'admik-storefront-audit-w10',
  description: 'Волна 10: регресс фиксов волны 9 + безопасность нового платёжного контура + завершающий свип customer journey',
  phases: [
    { title: 'Find', detail: '6 финдеров: регресс волны 9 + безопасность оплаты + completeness' },
    { title: 'Verify', detail: 'скептик трассирует каждую находку по реальному коду' },
    { title: 'Refute', detail: 'второй независимый скептик опровергает real-помеченные' },
  ],
}

const FINDING_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: { findings: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['file', 'line', 'severity', 'title', 'claim', 'repro', 'proposedFix'],
    properties: {
      file: { type: 'string' }, line: { type: 'number' },
      severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
      title: { type: 'string' }, claim: { type: 'string' }, repro: { type: 'string' }, proposedFix: { type: 'string' },
    },
  } } },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'confidence', 'severity', 'reasoning', 'codeEvidence', 'repro', 'proposedFix'],
  properties: {
    verdict: { type: 'string', enum: ['real', 'refuted', 'uncertain'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    severity: { type: 'string', enum: ['critical', 'major', 'minor', 'n/a'] },
    reasoning: { type: 'string' }, codeEvidence: { type: 'string' }, repro: { type: 'string' }, proposedFix: { type: 'string' },
  },
}
const REFUTE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['refuted', 'reasoning'],
  properties: { refuted: { type: 'boolean' }, reasoning: { type: 'string' } },
}

const SF = '/home/claudeuser/admik/THE CASE/src'
const LIB = '/home/claudeuser/admik/lib'
const APP = '/home/claudeuser/admik/app'
const COMMON = 'Витрина THE CASE (Next.js 15, потребитель Storefront API Admik) + backend Admik. Код витрины: ' + SF + '; backend: ' + LIB + ' и ' + APP + '. ' +
  'Anti-tamper (ADR-010): ИТОГ/сумму считает СЕРВЕР Admik. СДЭК+Т-Банк на стенде в MOCK (ключей нет). ' +
  'ВОЛНА 10 — РЕГРЕСС/БЕЗОПАСНОСТЬ только что добавленного кода (волны 8–9). Уже сделано (НЕ репортить как баг): ' +
  'volna8 — submittedRef-гард, cityCode в quote/order, isValidEmail, quote-на-выбор-ПВЗ, citiesSeqRef, activePrice, Header из категорий, LuxuryImageSwap плейсхолдер, рекурсивный categorySubtreeIds, mockSearchCities синтет.город. ' +
  'volna9 — ОНЛАЙН-ОПЛАТА: витрина checkout вызывает initPayment(returnUrl)→redirect на paymentUrl; client.ts initPayment; Admik /payments/tbank/init принимает returnUrl; demo-страница ' + APP + '/mock/tbank/pay (строго mock, notFound в боевом); PaymentService.confirmMockPayment (строго mock-gated, помечает paid через recordWebhookEvent); requestOrigin из X-Forwarded-Host; escapeLike (ILIKE % _ \\) в catalog+cms; pluralRu; поиск limit 60; account гейт linkedOrder/!orderParam; Header key=label; setAdded(false) при смене размера; layout getCategories с таймаутом 2.5с. ' +
  'Ищи РЕАЛЬНЫЕ дефекты КОРРЕКТНОСТИ/БЕЗОПАСНОСТИ/ДЕНЕГ/UX, ВНЕСЁННЫЕ этими правками, либо оставшиеся в customer journey. Читай РЕАЛЬНЫЙ код. Сообщай ТОЛЬКО воспроизводимое. Лучше 0 находок, чем спекуляция. JSON (пустой список допустим).'

const FINDERS = [
  { key: 'payment-flow-regression',
    prompt: 'РЕГРЕСС платёжного потока витрины (' + SF + '/app/checkout/page.tsx handleSubmit + ' + SF + '/lib/admik/client.ts initPayment). Проверь новый поток: createOrder → addOrder → submittedRef=true → clearCart → initPayment → window.location.href=paymentUrl, иначе router.push(/account). Ищи: что если initPayment ВЕРНУЛСЯ но paymentUrl пуст/невалиден (редирект в никуда)? двойной клик «Подтвердить заказ» при loading (setLoading(true) есть, но кнопка disabled?) → двойной createOrder/двойная оплата? после window.location.href setLoading не сбрасывается — норм ли при ошибке? idempotencyKey сохраняется при повторе после сбоя оплаты? состояние, где заказ создан но оплата не инициирована и покупатель НЕ узнал номер? возврат назад из шлюза. Только реальные регрессы.' },
  { key: 'payment-security',
    prompt: 'БЕЗОПАСНОСТЬ платёжного контура (' + APP + '/mock/tbank/pay/page.tsx + ' + APP + '/api/storefront/v1/payments/tbank/init/route.ts + ' + LIB + '/payments/tbank/service.ts confirmMockPayment). Проверь: (1) confirmMockPayment СТРОГО mock-gated (в боевом РЕФЬЮЗ) — нет ли пути обхода; в mock — может ли кто-то пометить оплаченным ЧУЖОЙ заказ (есть ли проверка владения? нужна ли она в mock без денег?); (2) mock-pay страница ПУБЛИЧНА — open-redirect через returnUrl (валидируется http(s), withParam→/ при битом — достаточно ли? можно ли javascript:/data:/ или редирект на фишинг-домен?); (3) init-роут: returnUrl с .url() — пропускает любой домен (редирект на чужой сайт после demo-оплаты?); anti-enumeration (token|email) сохранён; (4) утечка данных заказа на mock-странице (только orderId/amount из URL — ок?). Оцени РЕАЛЬНЫЙ риск (помни: mock=без денег, прод=gated). Только воспроизводимые дефекты безопасности.' },
  { key: 'admik-payment-server',
    prompt: 'РЕГРЕСС backend-оплаты Admik (' + LIB + '/payments/tbank/service.ts initPayment+confirmMockPayment, ' + LIB + '/payments/tbank/mock/index.ts mockInitPayment, ' + LIB + '/payments/tbank/repository.ts recordWebhookEvent). Проверь: confirmMockPayment использует order.grandTotal/paymentId корректно (paymentId из URL совпадает с тем, что init сохранил в payment_ref?); идемпотентность recordWebhookEvent (UNIQUE payment_id,status) — повторный «Оплатить (демо)» не двоит эффект; mockInitPayment с returnUrl — корректное кодирование URL в query (вложенный URL с & и ? не ломает парсинг?); requestOrigin X-Forwarded-Host — инъекция заголовка (если прокси не перезапишет, клиент подделает Host→ mock-URL на чужой домен?); статус-переход pending→paid валиден. Только реальные дефекты.' },
  { key: 'search-account-regression',
    prompt: 'РЕГРЕСС поиска и ЛК. ПОИСК: ' + LIB + '/db/like.ts escapeLike + ' + LIB + '/catalog/repository.ts + ' + SF + '/app/search/page.tsx. Проверь: escapeLike — ILIKE реально использует backslash как ESCAPE по умолчанию (нужен ли явный ESCAPE-клоз? standard_conforming_strings)? экранированный паттерн матчит буквальный «%»? не сломан ли обычный поиск; pluralRu (' + SF + '/lib/plural.ts) граничные; limit 60. ЛК: ' + SF + '/app/account/page.tsx — гейт фильтра на linkedOrder: в ГЕНУИННОМ пост-чекауте (token валиден, linked грузится) не пропадает ли свой заказ на время загрузки/при сбое linked; баннер на ?paid; StoredOrderCard. Только реальные регрессы.' },
  { key: 'journey-completeness',
    prompt: 'ЗАВЕРШАЮЩИЙ свип customer journey (весь ' + SF + '/app/* + компоненты). Покупатель в РАЗНЫХ сценариях, не покрытых волнами 8–9: пустая корзина → /checkout (редирект на /cart?); отмена оплаты (возврат с ?payment=cancelled — как обрабатывается в account/page.tsx? есть ли обработка?); возврат к УЖЕ оплаченному заказу (повторная инициация init → conflict «уже оплачен» — видит ли это покупатель?); несколько заказов в ЛК; добавление в корзину товара БЕЗ id (productId/variantId отсутствует → quote/order упадёт?); количество > остатка на чекауте; смена количества в корзине до 0; навигация назад после clearCart. Ищи реальные тупики/ошибки/неудобства покупателя.' },
  { key: 'cross-cutting',
    prompt: 'СКВОЗНЫЕ дефекты на стыке витрина↔Admik в новом коде. Проверь: контракт initPayment — витрина шлёт {orderNumber, accessToken, returnUrl}, Admik InitSchema.strip() (лишние поля?), ответ {paymentUrl,paymentId,status,isMock} — типы совпадают (AdmikPaymentInitDto)? mapPaymentMethod витрины (cdek-pay/card/sbp) → enum Admik — все ли онлайн-методы реально инициируют оплату или какой-то падает? deliveryCost после handlePvzSelect: если quote упал (catch{}) — остаётся сырой cdekCalculate.cost, а на шаге 3 goToPayment пере-quote'ит — рассинхрон цены между шагами? module payments выключен → initPayment 404 → витрина молча ведёт в /account с неоплаченным заказом (UX: покупатель думает что оплатил?). Только реальные дефекты контракта/денег/UX.' },
]

phase('Find')
const finderResults = await parallel(
  FINDERS.map((f) => () => agent(COMMON + '\n\nДОМЕН: ' + f.key + '.\n' + f.prompt, { label: 'find:' + f.key, phase: 'Find', schema: FINDING_SCHEMA }))
)

const all = []
finderResults.filter(Boolean).forEach((r, i) => {
  ;(r.findings || []).forEach((fd, j) => all.push({ ...fd, id: FINDERS[i].key + '#' + (j + 1), domain: FINDERS[i].key }))
})
log('Финдеры волны 10 выдали ' + all.length + ' находок. Верификация…')
if (all.length === 0) return { confirmed: [], overturned: [], refuted: [], note: 'Волна 10: финдеры не нашли находок (сходимость?).' }

const verified = await pipeline(
  all,
  (fd) => agent(
    'Ты — скептичный верификатор (волна 10). БОЛЬШИНСТВО находок ложные — опровергай спекуляцию, подтверждай только воспроизводимое в ТЕКУЩЕМ коде (с учётом фиксов волн 8–9). ' +
    COMMON + '\n\nНАХОДКА [' + fd.id + '] sev(финдер)=' + fd.severity + '\nФайл: ' + fd.file + ':' + fd.line + '\nЗаголовок: ' + fd.title + '\nУтверждение: ' + fd.claim + '\nРепро: ' + fd.repro + '\nФикс: ' + fd.proposedFix + '\n\nОткрой реальный код, проследи поток. verdict="real" ТОЛЬКО при конкретном воспроизводимом дефекте; иначе "refuted". JSON (codeEvidence — реальный фрагмент).',
    { label: 'verify:' + fd.id, phase: 'Verify', schema: VERDICT_SCHEMA }
  ),
  async (v, fd) => {
    if (!v || v.verdict !== 'real') return v ? { ...v, finding: fd } : null
    const refute = await agent(
      'Ты — ВТОРОЙ независимый скептик. Первый счёл [' + fd.id + '] реальной. Опровергни по фактическому коду (защита выше/by-design/мисрид/неверная трассировка/уже исправлено/риск только в mock без денег). По умолчанию refuted=true.\n' +
      COMMON + '\n\n[' + fd.id + '] ' + fd.title + ' (' + fd.file + ')\nУтверждение: ' + fd.claim + '\nВердикт первого: ' + v.reasoning + '\nКод: ' + v.codeEvidence + '\n\nПроверь сам. JSON: refuted, reasoning (с цитатой кода).',
      { label: 'refute:' + fd.id, phase: 'Refute', schema: REFUTE_SCHEMA }
    )
    return { ...v, finding: fd, secondSkeptic: refute }
  }
)

const clean = verified.filter(Boolean)
const confirmed = clean.filter(v => v.verdict === 'real' && !(v.secondSkeptic && v.secondSkeptic.refuted))
const overturned = clean.filter(v => v.verdict === 'real' && v.secondSkeptic && v.secondSkeptic.refuted)
const refuted = clean.filter(v => v.verdict !== 'real')
log('ИТОГ волны 10: подтверждено=' + confirmed.length + ', опровергнуто 2-м=' + overturned.length + ', опровергнуто сразу=' + refuted.length + ' (из ' + all.length + ')')

return {
  confirmed: confirmed.map(v => ({ id: v.finding.id, domain: v.finding.domain, file: v.finding.file, line: v.finding.line, severity: v.severity, title: v.finding.title, reasoning: v.reasoning, repro: v.repro, proposedFix: v.proposedFix, codeEvidence: v.codeEvidence })),
  overturned: overturned.map(v => ({ id: v.finding.id, title: v.finding.title, why: v.secondSkeptic.reasoning })),
  refuted: refuted.map(v => ({ id: v.finding.id, title: v.finding.title, reasoning: v.reasoning })),
}
