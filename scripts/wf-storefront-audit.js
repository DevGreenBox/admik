export const meta = {
  name: 'admik-storefront-audit',
  description: 'Comprehensive adversarial audit of THE CASE storefront + Admik checkout path (never audited before)',
  phases: [
    { title: 'Find', detail: '7 finders across storefront customer journey + Admik checkout API' },
    { title: 'Verify', detail: 'skeptic traces each finding against real code' },
    { title: 'Refute', detail: 'second independent skeptic tries to refute real-flagged' },
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
  'Адаптер витрины: ' + SF + '/lib/admik/* (client/adapter/types). Anti-tamper (ADR-010): ИТОГ заказа считает СЕРВЕР Admik; витрина не должна доверять своим расчётам денег. СДЭК на стенде в mock (ключей нет). ' +
  'Эта витрина НИКОГДА не проходила аудит — вероятны реальные баги в клиентском пути (особенно чекаут). Ищи дефекты КОРРЕКТНОСТИ/UX/ДЕНЕГ/НАДЁЖНОСТИ, ломающие реальный путь покупателя при РАЗНЫХ вариантах заполнения данных. ' +
  'Читай РЕАЛЬНЫЙ код, прослеживай поток данных/запросы к Admik API. Сообщай ТОЛЬКО воспроизводимое (конкретные входы+шаги→неверное поведение). Лучше 0 находок, чем спекуляция. Верни JSON (пустой список допустим).'

const FINDERS = [
  { key: 'checkout-flow',
    prompt: 'Аудит ЧЕКАУТА (' + SF + '/app/checkout/page.tsx + ' + SF + '/lib/checkout.ts + клиент cdekCities/cdekPvz/cdekCalculate/createOrder в ' + SF + '/lib/admik/client.ts). Это путь, где клиент уже нашёл баг (подсказки города). Проверь ВЕСЬ поток при РАЗНЫХ данных: ввод города (есть/нет подсказок, выбор, кириллица/латиница, debounce, гонки запросов, город без ПВЗ), выбор ПВЗ, расчёт доставки, способ оплаты, серверный quote, создание заказа (idempotency-key, повтор, ошибки сети/валидации), переход к оплате/подтверждению. Ищи: состояния, где кнопка «оформить» активна без валидных данных; рассинхрон выбранного города/ПВЗ/расчёта; потеря idempotency; неверная сумма к оплате (доверие клиентскому расчёту вместо server quote); необработанные ошибки API (пустой ответ, 4xx/5xx) → белый экран/зависание; что происходит при пустой корзине; что при mock-городе без ПВЗ.' },
  { key: 'cart-state',
    prompt: 'Аудит КОРЗИНЫ/ИЗБРАННОГО/СОСТОЯНИЯ (' + SF + '/app/cart/page.tsx, ' + SF + '/app/wishlist/page.tsx, ' + SF + '/lib/store.ts). Проверь: добавление/удаление/изменение количества, варианты (размер/цвет) как ключ позиции, дубли позиций, персистентность (localStorage) и гидрация (SSR/CSR несоответствие), итог корзины (должен сверяться с server quote, не доверять клиенту), переполнение/отрицательные qty, пустые состояния, потеря корзины при навигации. Ищи реальные баги количества/ключей/итогов/гидрации.' },
  { key: 'product-page',
    prompt: 'Аудит КАРТОЧКИ ТОВАРА (' + SF + '/app/product/[slug]/page.tsx, ' + SF + '/components/product/ProductDetailClient.tsx, ProductGallery.tsx, SizeGuide.tsx, StickyAddToCart.tsx). Проверь: выбор варианта/размера, доступность (inStock на уровне варианта vs товара), добавление в корзину без выбора размера, галерея (главные фото — клиент жалуется что не влезают в экран; таблица размеров — клиент: при клике таблица опускается вниз и её не видно), цена/скидка, отсутствующие данные (нет вариантов/фото/описания), товар не найден (404). Ищи реальные баги выбора/доступности/отображения/размерной таблицы.' },
  { key: 'catalog-search',
    prompt: 'Аудит КАТАЛОГА/ПОИСКА (' + SF + '/app/catalog/page.tsx, ' + SF + '/components/catalog/CatalogPage.tsx, ProductCard.tsx, ' + SF + '/app/search/page.tsx, ' + SF + '/lib/catalog-view.ts). Проверь: листинг, фильтр по категории (?category=women/men — клиент хочет это в навигации), поиск, пагинация, пустой каталог (на стенде каталог ПУСТ — что показывается?), цены/бейджи, переход в карточку, обработка ошибок API. Ищи реальные баги фильтра/пустых состояний/цен.' },
  { key: 'admik-adapter',
    prompt: 'Аудит АДАПТЕРА Admik (' + SF + '/lib/admik/client.ts, adapter.ts, types.ts, index.ts). Проверь контракт с Admik Storefront API: маппинг DTO (товары/варианты/цены в копейках↔рубли, inStock, изображения), обработка ошибок/таймаутов/не-2xx, авторизация (Origin/ключ — НЕ светить ключ в браузер), пагинация, кодирование query (кириллица), устойчивость к неожиданной форме ответа (null/отсутствующие поля). Сверь типы витрины с реальными DTO Admik (/home/claudeuser/admik/lib/storefront/dto.ts). Ищи реальные расхождения контракта/маппинга/денег/ошибок.' },
  { key: 'render-robustness',
    prompt: 'Аудит НАДЁЖНОСТИ РЕНДЕРА (' + SF + '/app/layout.tsx, error.tsx, not-found.tsx, loading.tsx, ' + SF + '/components/layout/*, Providers.tsx, ' + SF + '/components/ui/*). Проверь: error boundary (что видит пользователь при сбое), hydration mismatch (use client/SSR, Date/random/localStorage в рендере), битые ссылки/якоря в навигации (после правок: /#shop, /#about, /#materials удалён?), доступность (alt/aria), мобильное меню, robots/sitemap (' + SF + '/app/robots.ts, sitemap.ts). Ищи реальные баги рендера/навигации/гидрации.' },
  { key: 'admik-checkout-api',
    prompt: 'Аудит ADMIK-СТОРОНЫ чекаут-пути (/home/claudeuser/admik/app/api/storefront/v1/delivery/cdek/{cities,pvz,calculate}, /orders, /cart/quote и lib/cdek/services/{city,pvz,calculator}, lib/cdek/mock/*). СДЭК в mock: проверь, что mock-путь даёт РАБОЧИЙ end-to-end чекаут хотя бы для части городов (город→ПВЗ→расчёт→заказ). Ищи: города без ПВЗ в mock (выбор города → пустой список ПВЗ → тупик); рассинхрон cityCode между cities/pvz/calculate; mock-расчёт/ПВЗ не покрывает выбранные города; ошибки валидации query (кириллица в q); что отдаётся при отсутствии ключей. Цель — найти, где реальный покупатель застрянет.' },
]

phase('Find')
const finderResults = await parallel(
  FINDERS.map((f) => () => agent(COMMON + '\n\nДОМЕН: ' + f.key + '.\n' + f.prompt, { label: 'find:' + f.key, phase: 'Find', schema: FINDING_SCHEMA }))
)

const all = []
finderResults.filter(Boolean).forEach((r, i) => {
  ;(r.findings || []).forEach((fd, j) => all.push({ ...fd, id: FINDERS[i].key + '#' + (j + 1), domain: FINDERS[i].key }))
})
log('Финдеры выдали ' + all.length + ' находок. Верификация…')
if (all.length === 0) return { confirmed: [], overturned: [], refuted: [], note: 'Финдеры не нашли находок.' }

const verified = await pipeline(
  all,
  (fd) => agent(
    'Ты — скептичный верификатор витрины THE CASE. БОЛЬШИНСТВО находок ложные — опровергай спекуляцию, подтверждай только воспроизводимое в ТЕКУЩЕМ коде. ' +
    COMMON + '\n\nНАХОДКА [' + fd.id + '] sev(финдер)=' + fd.severity + '\nФайл: ' + fd.file + ':' + fd.line + '\nЗаголовок: ' + fd.title + '\nУтверждение: ' + fd.claim + '\nРепро: ' + fd.repro + '\nФикс: ' + fd.proposedFix + '\n\nОткрой реальный код, проследи поток. verdict="real" ТОЛЬКО при конкретном воспроизводимом дефекте; иначе "refuted". JSON (codeEvidence — реальный фрагмент).',
    { label: 'verify:' + fd.id, phase: 'Verify', schema: VERDICT_SCHEMA }
  ),
  async (v, fd) => {
    if (!v || v.verdict !== 'real') return v ? { ...v, finding: fd } : null
    const refute = await agent(
      'Ты — ВТОРОЙ независимый скептик. Первый счёл [' + fd.id + '] реальной. Опровергни по фактическому коду (защита выше/by-design/мисрид/неверная трассировка). По умолчанию refuted=true.\n' +
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
log('ИТОГ аудита витрины: подтверждено=' + confirmed.length + ', опровергнуто 2-м=' + overturned.length + ', опровергнуто сразу=' + refuted.length + ' (из ' + all.length + ')')

return {
  confirmed: confirmed.map(v => ({ id: v.finding.id, domain: v.finding.domain, file: v.finding.file, line: v.finding.line, severity: v.severity, title: v.finding.title, reasoning: v.reasoning, repro: v.repro, proposedFix: v.proposedFix, codeEvidence: v.codeEvidence })),
  overturned: overturned.map(v => ({ id: v.finding.id, title: v.finding.title, why: v.secondSkeptic.reasoning })),
  refuted: refuted.map(v => ({ id: v.finding.id, title: v.finding.title, reasoning: v.reasoning })),
}
