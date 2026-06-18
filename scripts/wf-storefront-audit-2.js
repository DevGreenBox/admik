export const meta = {
  name: 'admik-storefront-audit-w9',
  description: 'Волна 9: аудит непокрытых зон витрины THE CASE (account/payment/search/render) + регресс фиксов волны 8 + edge-кейсы Storefront API Admik',
  phases: [
    { title: 'Find', detail: '7 финдеров: непокрытые зоны витрины + регресс волны 8 + Admik storefront API' },
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
const COMMON = 'Витрина THE CASE — Next.js 15 (App Router), потребитель публичного Storefront API Admik. Код витрины: ' + SF + ' (читай ТОЛЬКО там и в /home/claudeuser/admik/lib для Admik-стороны). ' +
  'Адаптер витрины: ' + SF + '/lib/admik/* (client/adapter/types). Anti-tamper (ADR-010): ИТОГ заказа считает СЕРВЕР Admik. СДЭК на стенде в mock (ключей нет); Т-Банк-ключей тоже нет. ' +
  'ВОЛНА 9: волна 8 уже нашла и ИСПРАВИЛА 12 багов (checkout submittedRef-гард, cityCode в quote/order, isValidEmail, quote-на-выбор-ПВЗ, citiesSeqRef, activePrice варианта, if(added)return, Header из реальных категорий, LuxuryImageSwap плейсхолдер, loading HEADER_OFFSET; backend: mockSearchCities синтет.город, рекурсивный categorySubtreeIds). НЕ репорти то, что уже исправлено. ' +
  'Ищи дефекты КОРРЕКТНОСТИ/UX/ДЕНЕГ/НАДЁЖНОСТИ в реальном пути покупателя при РАЗНЫХ данных, ОСОБЕННО в зонах, которые волна 8 НЕ покрывала. Читай РЕАЛЬНЫЙ код, прослеживай поток данных/запросы к Admik. Сообщай ТОЛЬКО воспроизводимое (конкретные входы+шаги→неверное поведение). Лучше 0 находок, чем спекуляция. Верни JSON (пустой список допустим).'

const FINDERS = [
  { key: 'account-tracking',
    prompt: 'Аудит ЛИЧНОГО КАБИНЕТА/ТРЕКИНГА (' + SF + '/app/account/page.tsx + ' + SF + '/lib/store.ts orders/addOrder + клиент getOrder в ' + SF + '/lib/admik/client.ts + Admik GET /orders/{number} в /home/claudeuser/admik/app/api/storefront/v1/orders/[number]/route.ts и lib/storefront/order-dto.ts). Это куда попадает покупатель ПОСЛЕ заказа (?order=&token=). Проверь: показ заказа по token из URL; список сохранённых заказов из localStorage (persist); ввод email/номера для поиска чужого/своего заказа (anti-enumeration: 404 при неверном proof?); протухший/неверный token; заказ не найден; гидрация (useHydrated) пустого ЛК; XSS/инъекция номера; что показывается при сетевой ошибке getOrder. Ищи реальные баги доступа к заказу/отображения/гидрации.' },
  { key: 'payment-page',
    prompt: 'Аудит ОПЛАТЫ (' + SF + '/app/payment/page.tsx + ' + SF + '/lib/payment.ts (PAYMENT_METHODS, mapPaymentMethod) + Admik POST /api/storefront/v1/payments/tbank/init в /home/claudeuser/admik/app/api/storefront/v1/payments/tbank/init/route.ts + lib/payments/tbank/{service,manager,mock}). Т-Банк-ключей НЕТ (mock/выключено). Проверь: что происходит при выборе оплаты «картой», если модуль payments выключен или ключей нет (module-gate); редирект на платёжную форму/payment-page; обработка отсутствия ключей (не белый экран); anti-tamper суммы; маппинг методов (cdek_pay/card/sbp/cod). Ищи реальные баги пути оплаты для покупателя при ОТСУТСТВИИ ключей и при выключенном модуле.' },
  { key: 'search',
    prompt: 'Аудит ПОИСКА (' + SF + '/app/search/page.tsx + ' + SF + '/lib/catalog-view.ts + клиент listProducts(q) + Admik /products?q= в /home/claudeuser/admik/app/api/storefront/v1/products/route.ts + lib/catalog/repository.ts ILIKE-поиск). Проверь end-to-end при РАЗНЫХ запросах: кириллица, латиница, пустой запрос, спецсимволы/%_ (ILIKE-инъекция паттерна?), очень длинный запрос, запрос без результатов (что показывается), плюрализация подписи результатов, кодирование query (encodeURIComponent), пагинация поиска. Ищи реальные баги поиска: пустые/неверные результаты, падение, неэкранированные ILIKE-метасимволы, плохой UX пустого результата.' },
  { key: 'render-robustness',
    prompt: 'Аудит НАДЁЖНОСТИ РЕНДЕРА/НАВИГАЦИИ (' + SF + '/app/layout.tsx (теперь async getCategories на КАЖДОЙ странице!), ' + SF + '/app/error.tsx, not-found.tsx, ' + SF + '/components/Providers.tsx, ' + SF + '/components/layout/{Header,Footer}.tsx, ' + SF + '/app/robots.ts, sitemap.ts). ОСОБОЕ внимание новому коду волны 8: layout стал async и вызывает getCategories() на КАЖДЫЙ рендер страницы — проверь: что при сбое/таймауте Admik (try/catch есть, но не вешает ли это весь сайт латентностью? не ломает ли статическую генерацию? не кэшируется — fetch на каждый запрос); Header теперь получает categories проп — что при пустом массиве (фолбэк), что при категории без slug. Проверь error boundary (что видит юзер при сбое), hydration mismatch, битые якоря навигации (#about/#delivery/#contacts — есть ли эти секции на главной?), мобильное меню, robots/sitemap. Ищи реальные баги рендера/навигации/гидрации/производительности от изменений волны 8.' },
  { key: 'wave8-regression',
    prompt: 'РЕГРЕСС ФИКСОВ ВОЛНЫ 8 — ищи дефекты, ВНЕСЁННЫЕ самими фиксами. Проверь по реальному коду: (1) ' + SF + '/app/checkout/page.tsx submittedRef — не остаётся ли true при ОШИБКе заказа (тогда после ошибки и ручной очистки корзины редирект на /cart не сработает)? citiesSeqRef vs citySeqRef — не перепутаны ли; handlePvzSelect молча глотает ошибку quote (catch{}) — не покажет ли устаревшую/предварительную стоимость как финальную? deliveryCost перезаписывается quote.deliveryTotal — а если quote упал, остаётся сырой тариф (рассинхрон вернулся?). (2) ' + SF + '/components/product/ProductDetailClient.tsx activePrice/ctaLabel/if(added)return — не блокирует ли if(added) добавление ДРУГОГО размера в течение 2с; productCtaLabel приоритеты. (3) ' + SF + '/lib/product-cta.ts граничные комбинации. (4) ' + SF + '/components/ui/LuxuryImageSwap.tsx primary?:null — alt/доступность плейсхолдера, hasSwap при null. (5) ' + SF + '/components/layout/Header.tsx — encodeURIComponent slug, мобильное подменю из categories. Ищи ТОЛЬКО реальные новые дефекты, внесённые волной 8.' },
  { key: 'admik-storefront-dto',
    prompt: 'Аудит ADMIK STOREFRONT DTO/ДЕНЬГИ (/home/claudeuser/admik/lib/storefront/{dto.ts,order-dto.ts,queries.ts,response.ts} + lib/catalog/repository.ts listProducts/categorySubtreeIds + lib/orders pricing/money). Проверь: конверсия копейки↔рубли (где числа как строки NUMERIC — formatPrice на витрине ждёт number? cost/price строкой vs числом → NaN/конкатенация?), null/отсутствующие поля DTO, compareAtPrice/discountPct корректность. ОСОБОЕ внимание новому categorySubtreeIds (WITH RECURSIVE по parent_id): что если parent_id образует ЦИКЛ (A→B→A) — UNION ALL без защиты от цикла → бесконечная рекурсия/таймаут? (есть ли защита от циклов в moveCategory/создании?). Большое поддерево — перф. Ищи реальные дефекты контракта/денег/рекурсии.' },
  { key: 'cart-quote-order-edges',
    prompt: 'Аудит EDGE-КЕЙСОВ /cart/quote и /orders Admik (которые дёргает витрина) — /home/claudeuser/admik/app/api/storefront/v1/{cart/quote,orders}/route.ts + lib/orders/{actions,repository,pricing,promo,delivery-cost}. Проверь при РАЗНЫХ входах от витрины: cityCode теперь приходит из витрины (волна 8) — валидируется ли (отрицательный/огромный/синтетический MOCK-код)? смешанные productId+variantId в одной позиции; qty=0/отрицательный/дробный/огромный; промокод + доставка вместе; idempotency-key повтор с РАЗНЫМ телом (должен ли вернуть старый заказ или ошибку?); пустые items; несуществующий productId/variantId; quote для распроданного. Ищи реальные баги денег/валидации/идемпотентности на стыке витрина→Admik.' },
]

phase('Find')
const finderResults = await parallel(
  FINDERS.map((f) => () => agent(COMMON + '\n\nДОМЕН: ' + f.key + '.\n' + f.prompt, { label: 'find:' + f.key, phase: 'Find', schema: FINDING_SCHEMA }))
)

const all = []
finderResults.filter(Boolean).forEach((r, i) => {
  ;(r.findings || []).forEach((fd, j) => all.push({ ...fd, id: FINDERS[i].key + '#' + (j + 1), domain: FINDERS[i].key }))
})
log('Финдеры волны 9 выдали ' + all.length + ' находок. Верификация…')
if (all.length === 0) return { confirmed: [], overturned: [], refuted: [], note: 'Волна 9: финдеры не нашли находок.' }

const verified = await pipeline(
  all,
  (fd) => agent(
    'Ты — скептичный верификатор витрины THE CASE (волна 9). БОЛЬШИНСТВО находок ложные — опровергай спекуляцию, подтверждай только воспроизводимое в ТЕКУЩЕМ коде (с учётом уже сделанных фиксов волны 8). ' +
    COMMON + '\n\nНАХОДКА [' + fd.id + '] sev(финдер)=' + fd.severity + '\nФайл: ' + fd.file + ':' + fd.line + '\nЗаголовок: ' + fd.title + '\nУтверждение: ' + fd.claim + '\nРепро: ' + fd.repro + '\nФикс: ' + fd.proposedFix + '\n\nОткрой реальный код, проследи поток. verdict="real" ТОЛЬКО при конкретном воспроизводимом дефекте; иначе "refuted". JSON (codeEvidence — реальный фрагмент).',
    { label: 'verify:' + fd.id, phase: 'Verify', schema: VERDICT_SCHEMA }
  ),
  async (v, fd) => {
    if (!v || v.verdict !== 'real') return v ? { ...v, finding: fd } : null
    const refute = await agent(
      'Ты — ВТОРОЙ независимый скептик. Первый счёл [' + fd.id + '] реальной. Опровергни по фактическому коду (защита выше/by-design/мисрид/неверная трассировка/уже исправлено волной 8). По умолчанию refuted=true.\n' +
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
log('ИТОГ волны 9: подтверждено=' + confirmed.length + ', опровергнуто 2-м=' + overturned.length + ', опровергнуто сразу=' + refuted.length + ' (из ' + all.length + ')')

return {
  confirmed: confirmed.map(v => ({ id: v.finding.id, domain: v.finding.domain, file: v.finding.file, line: v.finding.line, severity: v.severity, title: v.finding.title, reasoning: v.reasoning, repro: v.repro, proposedFix: v.proposedFix, codeEvidence: v.codeEvidence })),
  overturned: overturned.map(v => ({ id: v.finding.id, title: v.finding.title, why: v.secondSkeptic.reasoning })),
  refuted: refuted.map(v => ({ id: v.finding.id, title: v.finding.title, reasoning: v.reasoning })),
}
