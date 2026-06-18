export const meta = {
  name: 'admik-storefront-audit-w11',
  description: 'Волна 11: финальный регресс волны 10 + холистический свип customer journey + деньги (контроль сходимости)',
  phases: [
    { title: 'Find', detail: '5 финдеров: регресс волны 10 + journey + деньги' },
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
const COMMON = 'Витрина THE CASE (Next.js 15, потребитель Storefront API Admik) + backend Admik. Витрина: ' + SF + '; backend: ' + LIB + ' и ' + APP + '. ' +
  'Anti-tamper (ADR-010): сумму/итог считает СЕРВЕР Admik. СДЭК+Т-Банк на стенде в MOCK. ' +
  'ВОЛНА 11 — ФИНАЛЬНЫЙ регресс/контроль сходимости. Тренд подтверждённых: волны 8,9,10 = 12,8,3. ' +
  'Уже сделано (НЕ репортить): волны 8-9-10 — checkout submittedRef, cityCode в quote/order, isValidEmail, quote-на-выбор-ПВЗ, citiesSeqRef, activePrice, Header из категорий+key=label, LuxuryImageSwap плейсхолдер+a11y, recursiveCategorySubtreeIds, mockSearchCities синтет.город, escapeLike (ILIKE), pluralRu, поиск limit 60, account гейт linkedOrder/!orderParam, setAdded(false) при смене размера, layout getCategories timeout, ' +
  'ОНЛАЙН-ОПЛАТА: checkout инициирует Т-Банк ТОЛЬКО для card/sbp (cdek-pay в ЛК), initPayment+redirect, demo-страница ' + APP + '/mock/tbank/pay (строго mock, allowlist returnUrl по STOREFRONT_ALLOWED_ORIGINS, paid=1 только при ok), confirmMockPayment (строго mock-gated), кнопка «Оплатить картой» в карточке ЛК для неоплаченных online-заказов, баннер «Оплата не завершена» при ?payment=cancelled, requestOrigin из X-Forwarded-Host. ' +
  'Ищи РЕАЛЬНЫЕ дефекты КОРРЕКТНОСТИ/БЕЗОПАСНОСТИ/ДЕНЕГ/UX, ОСТАВШИЕСЯ или ВНЕСЁННЫЕ волной 10. Читай РЕАЛЬНЫЙ код. Сообщай ТОЛЬКО воспроизводимое. Лучше 0 находок (сходимость), чем спекуляция. JSON (пустой список ОЖИДАЕМ при сходимости).'

const FINDERS = [
  { key: 'pay-method-regression',
    prompt: 'РЕГРЕСС ветвления метода оплаты и доплаты (' + SF + '/app/checkout/page.tsx handleSubmit + ' + SF + '/app/account/page.tsx OrderCard/isPayable/handlePay). Проверь: (1) checkout — card/sbp → initPayment→redirect; cdek-pay → router.push(accountUrl). Нет ли метода, который НИ туда ни сюда? mapPaymentMethod неизвестное → unset → попадает в else (в ЛК) — ок? (2) account isPayable: status pending/unset/пусто И method card/sbp → кнопка «Оплатить». Заказ cdek-pay неоплаченный — кнопки нет (как доплатить СДЭК PAY?). Заказ ОПЛАЧЕННЫЙ — кнопки нет (верно)? (3) handlePay: returnUrl с token (linked/stored) и без token (lookup по email) — после оплаты возврат корректен? повторный клик «Оплатить» при уже идущем (paying) — disabled есть, но двойная инициация? (4) initPayment на уже оплаченный заказ → backend conflict «уже оплачен» → AdmikApiError → payError показан? Только реальные дефекты.' },
  { key: 'mock-pay-regression',
    prompt: 'РЕГРЕСС demo-страницы оплаты и backend (' + APP + '/mock/tbank/pay/page.tsx + ' + LIB + '/storefront/env.ts normalizeOrigin/parseAllowedOrigins + ' + LIB + '/payments/tbank/service.ts confirmMockPayment). Проверь allowlist: normalizeOrigin(returnUrl.origin) ∈ allowedOrigins — реально ли пропускает легитимный https://erfgq.website И https://www.erfgq.website (обе в .env), и БЛОКИРУЕТ чужой? нормализация регистра/порта/слэша согласована между parseAllowedOrigins и проверкой? пустой allowlist (env не задан) → всё уходит в корень сайта (легитимный возврат сломается)? withParam при битом/относительном URL → корень. confirmMockPayment: paymentId из URL может НЕ совпасть с payment_ref заказа (init сохранил свой) — recordWebhookEvent с чужим paymentId создаёт лишний лог-ряд, но статус всё равно paid? идемпотентность повторного «Оплатить». Только реальные дефекты (помни mock=без денег).' },
  { key: 'journey-final',
    prompt: 'ХОЛИСТИЧЕСКИЙ финальный свип customer journey (' + SF + '/app/* + компоненты + ' + SF + '/lib/store.ts). Покупатель сквозняком в реальных и краевых сценариях: главная→каталог→фильтр→карточка→корзина(qty±,удаление)→чекаут(контакты→город→ПВЗ→оплата)→шлюз→ЛК. Ищи ОСТАВШИЕСЯ тупики/ошибки/неудобства: пустая корзина на /checkout; товар без id (productId/variantId) в quote/order; qty>остаток на оформлении (сервер 409 — показан?); гидрация persist на разных страницах; навигация назад из шлюза (заказ создан, корзина пуста — повторное оформление?); двойной сабмит «Подтвердить заказ» (disabled во время loading?); ошибка сети на любом шаге. Только реальные воспроизводимые дефекты пути покупателя.' },
  { key: 'money-correctness',
    prompt: 'ДЕНЬГИ сквозняком (' + SF + '/app/checkout/page.tsx + ' + SF + '/components/product/ProductDetailClient.tsx + ' + SF + '/app/cart/page.tsx + ' + LIB + '/storefront/{dto,order-dto}.ts + ' + LIB + '/orders/{pricing,money,promo}.ts). Проверь согласованность сумм во ВСЕХ точках: цена на карточке (activePrice) → цена в корзине (item.price) → клиентский итог корзины (selectCartTotal, чисто визуальный) → серверный quote (itemsTotal/discount/delivery/grandTotal) → серверный order → отображение в ЛК (OrderCard) → Amount в Т-Банк (toKopecks(grandTotal)). Копейки↔рубли: где строки NUMERIC, где числа — нет ли NaN/конкатенации в formatPrice? Расхождение показанной и списываемой суммы? Доставка с порогом бесплатной (deliveryCost после handlePvzSelect vs grandTotal заказа). Только реальные денежные дефекты.' },
  { key: 'security-final',
    prompt: 'ФИНАЛЬНАЯ безопасность нового контура (' + APP + '/api/storefront/v1/payments/tbank/init/route.ts + ' + APP + '/mock/tbank/pay/page.tsx + ' + LIB + '/payments/tbank/service.ts + ' + LIB + '/storefront/order-dto.ts verifyOrderAccess). Проверь: init — anti-enumeration (token|email, единый not_found), returnUrl .url() пропускает чужой домен (но mock-страница его отвалит по allowlist — достаточно?); requestOrigin X-Forwarded-Host — может ли клиент подделать заголовок в обход Caddy (Caddy перезаписывает?) → mock-URL на чужой домен; confirmMockPayment строго mock-gated (в боевом refuse) — без обхода; mock-страница notFound в боевом; нет ли утечки чужого заказа через init/mock (verifyOrderAccess на init есть; на confirmMockPayment владение НЕ проверяется — риск в mock?). Оцени РЕАЛЬНЫЙ риск (mock=без денег, прод=gated). Только воспроизводимые дефекты.' },
]

phase('Find')
const finderResults = await parallel(
  FINDERS.map((f) => () => agent(COMMON + '\n\nДОМЕН: ' + f.key + '.\n' + f.prompt, { label: 'find:' + f.key, phase: 'Find', schema: FINDING_SCHEMA }))
)

const all = []
finderResults.filter(Boolean).forEach((r, i) => {
  ;(r.findings || []).forEach((fd, j) => all.push({ ...fd, id: FINDERS[i].key + '#' + (j + 1), domain: FINDERS[i].key }))
})
log('Финдеры волны 11 выдали ' + all.length + ' находок. Верификация…')
if (all.length === 0) return { confirmed: [], overturned: [], refuted: [], note: 'Волна 11: финдеры не нашли находок — СХОДИМОСТЬ.' }

const verified = await pipeline(
  all,
  (fd) => agent(
    'Ты — скептичный верификатор (волна 11, контроль сходимости). БОЛЬШИНСТВО находок ложные — опровергай спекуляцию, подтверждай только воспроизводимое в ТЕКУЩЕМ коде (с учётом фиксов волн 8-10). ' +
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
log('ИТОГ волны 11: подтверждено=' + confirmed.length + ', опровергнуто 2-м=' + overturned.length + ', опровергнуто сразу=' + refuted.length + ' (из ' + all.length + ')')

return {
  confirmed: confirmed.map(v => ({ id: v.finding.id, domain: v.finding.domain, file: v.finding.file, line: v.finding.line, severity: v.severity, title: v.finding.title, reasoning: v.reasoning, repro: v.repro, proposedFix: v.proposedFix, codeEvidence: v.codeEvidence })),
  overturned: overturned.map(v => ({ id: v.finding.id, title: v.finding.title, why: v.secondSkeptic.reasoning })),
  refuted: refuted.map(v => ({ id: v.finding.id, title: v.finding.title, reasoning: v.reasoning })),
}
