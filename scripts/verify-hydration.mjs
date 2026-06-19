// ============================================================================
// Регресс-харнесс: НЕТ hydration-mismatch (React #418/#423/#425) на витрине
// THE CASE при наличии сохранённого вишлиста/корзины в localStorage.
//
// КОНТЕКСТ (волна 15). Стор витрины создан с `skipHydration: true`, а регидрация
// persist запускается в `Providers` ВНУТРИ `useEffect` (после маунта). Поэтому
// первый клиентский рендер всегда идёт с пустым стором = совпадает с серверным
// → React #418 архитектурно предотвращён. Гейты `useHydrated` в компонентах,
// читающих стор (ProductCard вишлист-текст, корзина и т.д.), — ЗАЩИТНЫЕ: они
// держат инвариант и убирают мерцание empty→filled, но не «чинят живой #418».
//
// Этот харнесс — РЕГРЕСС-ГАРД: если кто-то перенесёт rehydrate() из useEffect в
// синхронный путь (или уберёт skipHydration), mismatch станет реальным и тест
// покраснеет. Гоняется против боевого стенда.
//
//   node scripts/verify-hydration.mjs
// Зелёный = ни одной hydration-ошибки во всех проверяемых состояниях.
// ============================================================================
import { chromium } from '@playwright/test';

const STORE = process.env.STORE || 'https://erfgq.website';
const HYDRA_RE = /418|419|420|421|422|423|424|425|Minified React|hydrat/i;

const out = [];
const rec = (s, step, d = '') => { out.push({ s, step, d }); console.log(`[${s}] ${step}${d ? ` — ${d}` : ''}`); };
const PASS = (s, d) => rec('PASS', s, d);
const FAIL = (s, d) => rec('FAIL', s, d);

const main = async () => {
  const browser = await chromium.launch();

  // Возьмём реальные slug'и товаров через витринный listing API Admik (origin витрины).
  let slugs = [];
  try {
    const api = 'https://admin.erfgq.website/api/storefront/v1/products?limit=12';
    const r = await fetch(api, { headers: { origin: STORE } });
    const j = await r.json();
    slugs = (j?.data || []).map((p) => p.slug).filter(Boolean);
  } catch { /* fallback ниже */ }
  if (slugs.length === 0) slugs = ['halat-meditsinskiy-belyy', 'bryuki-meditsinskie-sinie'];

  // Сценарии: для каждого — свежий контекст, посев localStorage, загрузка страницы,
  // сбор console-error/pageerror, фильтр по hydration-сигнатуре.
  const scenarios = [
    { label: 'каталог + вишлист (все товары залайканы)', url: '/catalog', wishlist: slugs.slice(0, 6) },
    { label: 'каталог?category + вишлист', url: '/catalog?category=meditsinskie-kostyumy', wishlist: slugs.slice(0, 6) },
    { label: 'каталог?sale + вишлист', url: '/catalog?sale=1', wishlist: slugs.slice(0, 6) },
    { label: 'главная + вишлист', url: '/', wishlist: slugs.slice(0, 6) },
    { label: 'карточка товара + вишлист', url: `/product/${slugs[0]}`, wishlist: [slugs[0]] },
    { label: 'вишлист-страница + вишлист', url: '/wishlist', wishlist: slugs.slice(0, 3) },
    { label: 'корзина + сохранённая корзина', url: '/cart', cart: [{ variantId: 'v1', slug: slugs[0], name: 'X', price: 1000, quantity: 2 }] },
    { label: 'каталог БЕЗ состояния (контроль)', url: '/catalog', wishlist: [] },
  ];

  for (const sc of scenarios) {
    const ctx = await browser.newContext({ locale: 'ru-RU' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errs.push('PAGEERR: ' + String(e).slice(0, 200)));
    try {
      // посев persist-стора до загрузки целевой страницы
      await page.goto(`${STORE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.evaluate((st) => {
        localStorage.setItem('the-case-store', JSON.stringify({
          state: { cart: st.cart || [], wishlist: st.wishlist || [], orders: [] }, version: 0,
        }));
      }, { cart: sc.cart, wishlist: sc.wishlist });
      // hydration-ошибки ловят слушатели console/pageerror выше; для их появления
      // нужен лишь load + время на регидрацию. `networkidle` НЕ годится: на главной
      // hero/анимации (framer-motion) не дают сети «затихнуть» → ложный timeout.
      await page.goto(`${STORE}${sc.url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('load', { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const hyd = errs.filter((e) => HYDRA_RE.test(e));
      if (hyd.length) FAIL(sc.label, `${hyd.length} hydration-ошибк(а): ${hyd[0].slice(0, 90)}`);
      else PASS(sc.label, `чисто (всего console-error=${errs.length})`);
    } catch (e) { FAIL(sc.label, e.message.slice(0, 120)); }
    await ctx.close();
  }

  await browser.close();
  const fails = out.filter((o) => o.s === 'FAIL');
  console.log(`\n===== ИТОГ HYDRATION: PASS=${out.filter((o) => o.s === 'PASS').length} FAIL=${fails.length} =====`);
  if (fails.length) { console.log('--- FAIL ---'); fails.forEach((f) => console.log(`  ✗ ${f.step}: ${f.d}`)); }
  process.exit(fails.length ? 1 : 0);
};
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
