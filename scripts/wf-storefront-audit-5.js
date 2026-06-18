export const meta = {
  name: 'admik-storefront-audit-w12',
  description: 'Волна 12: широкий свежий свип витрины+оплаты+денег (подтверждение сходимости)',
  phases: [
    { title: 'Find', detail: '5 свежих финдеров по всему пути покупателя + оплата + деньги' },
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
  'ВОЛНА 12 — ШИРОКИЙ ФИНАЛЬНЫЙ СВИП свежими углами (контроль сходимости; тренд подтверждённых 8,9,10,11 = 12,8,3,2). ' +
  'Витрина прошла 4 волны аудита, весь путь покупателя + онлайн-оплата уже работают и переверифицированы вживую (e2e 24/24). НЕ репортить уже сделанное (см. историю фиксов волн 8-11: платёжный поток card/sbp, demo mock-pay с allowlist, confirmMockPayment mock-gated, кнопка Оплатить картой в ЛК, рекурсивный каталог, escapeLike, и десятки других). ' +
  'Ищи ОСТАВШИЕСЯ РЕАЛЬНЫЕ дефекты КОРРЕКТНОСТИ/БЕЗОПАСНОСТИ/ДЕНЕГ/UX в пути покупателя или новом коде. Будь строг: подтверждай только КОНКРЕТНОЕ воспроизводимое. ОЖИДАЕМ малое число находок или ноль (сходимость). Читай РЕАЛЬНЫЙ код. JSON (пустой список — нормальный и ожидаемый результат).'

const FINDERS = [
  { key: 'checkout-fresh',
    prompt: 'Свежий полный аудит ЧЕКАУТА (' + SF + '/app/checkout/page.tsx + ' + SF + '/lib/checkout.ts). Пройди ВСЕ три шага и состояния заново: валидация контактов (имя/email/телефон, формат email), город (debounce, seq-токены, выбор/сброс), ПВЗ (quote на выбор), оплата (3 метода, ветвление card/sbp→Т-Банк, cdek-pay→ЛК), submittedRef, idempotencyKey, loading/disabled кнопок (двойной сабмит?), редиректы/гейты hydrated. Ищи КОНКРЕТНЫЕ оставшиеся дефекты состояний/гонок/валидации, не покрытые волнами 8-11.' },
  { key: 'payment-subsystem-fresh',
    prompt: 'Свежий аудит ВСЕГО платёжного контура end-to-end (' + SF + '/lib/admik/client.ts initPayment, ' + APP + '/api/storefront/v1/payments/tbank/init/route.ts, ' + APP + '/mock/tbank/pay/page.tsx, ' + LIB + '/payments/tbank/{service,mock/index,repository,status-map}.ts, ' + SF + '/app/account/page.tsx OrderCard/handlePay). Проверь жизненный цикл: init (auth token|email, anti-enum, conflict уже оплачен), redirect, demo-оплата/отмена/неуспех, confirmMockPayment (mock-gate, идемпотентность), статусы pending→paid, доплата из ЛК (token и email пути), возврат с paid/cancelled/failed. Ищи КОНКРЕТНЫЕ оставшиеся дефекты денег/статусов/авторизации/UX оплаты.' },
  { key: 'cart-account-store-fresh',
    prompt: 'Свежий аудит КОРЗИНЫ/ЛК/СОСТОЯНИЯ (' + SF + '/app/cart/page.tsx, ' + SF + '/app/account/page.tsx, ' + SF + '/app/wishlist/page.tsx, ' + SF + '/lib/store.ts). Проверь: zustand persist (skipHydration, useHydrated на всех страницах), ключ позиции (variantId), qty±/удаление/clearCart, дубли, гидрация SSR/CSR, список заказов в ЛК (StoredOrderCard, фильтр linkedOrder), избранное. Ищи КОНКРЕТНЫЕ оставшиеся дефекты состояния/гидрации/ключей, не покрытые ранее.' },
  { key: 'catalog-product-search-fresh',
    prompt: 'Свежий аудит КАТАЛОГА/КАРТОЧКИ/ПОИСКА (' + SF + '/components/catalog/*, ' + SF + '/components/product/*, ' + SF + '/app/catalog/page.tsx, ' + SF + '/app/product/[slug]/page.tsx, ' + SF + '/app/search/page.tsx, ' + SF + '/lib/catalog-view.ts, ' + LIB + '/catalog/repository.ts). Проверь: листинг/фильтр категории (рекурсивный)/сортировка/цена-фильтр, карточка (вариант/размер/цена/галерея/таблица размеров/sticky), поиск (escapeLike, limit, склонение), фото-плейсхолдер, пустые состояния, 404. Ищи КОНКРЕТНЫЕ оставшиеся дефекты, не покрытые волнами 8-11.' },
  { key: 'money-data-fresh',
    prompt: 'Свежий аудит ДЕНЕГ и ЦЕЛОСТНОСТИ ДАННЫХ на стыке (' + LIB + '/storefront/{dto,order-dto,queries,response}.ts, ' + LIB + '/orders/{pricing,money,promo,repository}.ts, ' + LIB + '/catalog/{pricing,repository}.ts, ' + SF + '/lib/format.ts). Проверь сквозную согласованность сумм (карточка→корзина→quote→order→ЛК→Т-Банк Amount), копейки↔рубли (строки NUMERIC vs числа, NaN/конкатенация в formatPrice), скидки/доставка/итог, промокоды (percent/fixed/bogo/free_delivery границы), резерв/остаток (oversell), снимок цены в позиции заказа. Ищи КОНКРЕТНЫЕ оставшиеся денежные/целостностные дефекты.' },
]

phase('Find')
const finderResults = await parallel(
  FINDERS.map((f) => () => agent(COMMON + '\n\nДОМЕН: ' + f.key + '.\n' + f.prompt, { label: 'find:' + f.key, phase: 'Find', schema: FINDING_SCHEMA }))
)

const all = []
finderResults.filter(Boolean).forEach((r, i) => {
  ;(r.findings || []).forEach((fd, j) => all.push({ ...fd, id: FINDERS[i].key + '#' + (j + 1), domain: FINDERS[i].key }))
})
log('Финдеры волны 12 выдали ' + all.length + ' находок. Верификация…')
if (all.length === 0) return { confirmed: [], overturned: [], refuted: [], note: 'Волна 12: финдеры не нашли находок — СХОДИМОСТЬ ПОДТВЕРЖДЕНА.' }

const verified = await pipeline(
  all,
  (fd) => agent(
    'Ты — строгий скептичный верификатор (волна 12, контроль сходимости). БОЛЬШИНСТВО находок ложные/уже исправлены — опровергай спекуляцию, подтверждай ТОЛЬКО конкретное воспроизводимое в ТЕКУЩЕМ коде (с учётом фиксов волн 8-11). ' +
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
log('ИТОГ волны 12: подтверждено=' + confirmed.length + ', опровергнуто 2-м=' + overturned.length + ', опровергнуто сразу=' + refuted.length + ' (из ' + all.length + ')')

return {
  confirmed: confirmed.map(v => ({ id: v.finding.id, domain: v.finding.domain, file: v.finding.file, line: v.finding.line, severity: v.severity, title: v.finding.title, reasoning: v.reasoning, repro: v.repro, proposedFix: v.proposedFix, codeEvidence: v.codeEvidence })),
  overturned: overturned.map(v => ({ id: v.finding.id, title: v.finding.title, why: v.secondSkeptic.reasoning })),
  refuted: refuted.map(v => ({ id: v.finding.id, title: v.finding.title, reasoning: v.reasoning })),
}
