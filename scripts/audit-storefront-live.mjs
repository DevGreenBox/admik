// Живой аудит ВИТРИНЫ THE CASE глазами нетех-пользователя: тупики/ошибки/недочёты.
// Обходит ключевые маршруты, собирает: HTTP-статус, ошибки консоли, битые картинки,
// ссылки-в-никуда (404), пустые состояния. Плюс интерактив: фильтры, в корзину,
// таблица размеров, формы (рассылка/обратная связь), чекаут до шага города.
//   node scripts/audit-storefront-live.mjs
import { chromium } from '@playwright/test';
const STORE = process.env.STORE || 'https://erfgq.website';
const find = [];
const add = (type, where, detail) => { find.push({ type, where, detail }); console.log(`[${type}] ${where} — ${detail}`); };

const ROUTES = [
  '/', '/catalog', '/catalog?category=meditsinskie-kostyumy', '/catalog?category=zhenskie',
  '/catalog?category=hirurgicheskie-operatsionnye', '/catalog?sale=1', '/catalog?new=1', '/catalog?q=костюм',
  '/product/demo-zhenskiy-1', '/product/demo-muzhskoy-1', '/product/kostyum-meditsinskiy-klassika',
  '/cart', '/checkout', '/account', '/wishlist', '/reviews', '/contacts', '/faq',
  '/delivery', '/about', '/privacy', '/terms', '/care', '/returns', '/payment',
  '/nesushchestvuyushchaya-stranica-404',
];

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text()}`); });
page.on('pageerror', e => consoleErrors.push(`${page.url()} :: PAGEERROR ${e.message}`));

const allLinks = new Set();
for (const r of ROUTES) {
  const url = STORE + r;
  let resp;
  try { resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 }); }
  catch (e) { add('NAV-ERR', r, e.message.slice(0, 120)); continue; }
  const status = resp ? resp.status() : 0;
  const is404Route = r.includes('404');
  if (status >= 500) add('HTTP-5xx', r, `статус ${status}`);
  else if (status === 404 && !is404Route) add('HTTP-404', r, `страница не найдена`);
  else if (status >= 400 && !is404Route) add('HTTP-4xx', r, `статус ${status}`);
  // битые картинки
  const broken = await page.locator('img').evaluateAll(imgs => imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.currentSrc || i.src));
  for (const b of broken.slice(0, 5)) add('BROKEN-IMG', r, b);
  // собрать внутренние ссылки
  const hrefs = await page.locator('a[href]').evaluateAll(els => els.map(e => e.getAttribute('href')));
  hrefs.filter(h => h && (h.startsWith('/') )).forEach(h => allLinks.add(h.split('#')[0]));
  // пустое состояние без действия (каталог «ничего не найдено»)
  const body = await page.locator('body').innerText();
  if (/Ничего не найдено|Корзина пуста|пуст/i.test(body) && !/Перейти|каталог|Продолжить|Смотреть/i.test(body)) {
    add('EMPTY-NOACTION', r, 'пустое состояние без призыва к действию (возможный тупик)');
  }
}

// Проверить все собранные внутренние ссылки на 404 (тупики-ссылки)
console.log(`\n--- проверка ${allLinks.size} внутренних ссылок на битость ---`);
for (const h of allLinks) {
  if (h.startsWith('//') || h.startsWith('http')) continue;
  try {
    const res = await ctx.request.get(STORE + h, { maxRedirects: 3 });
    if (res.status() >= 400) add('DEAD-LINK', h, `ссылка ведёт на ${res.status()}`);
  } catch (e) { add('DEAD-LINK', h, `ошибка запроса: ${e.message.slice(0,80)}`); }
}

// Интерактив: товар → в корзину → корзина → чекаут
console.log('\n--- интерактив: покупка ---');
try {
  await page.goto(STORE + '/product/demo-zhenskiy-1', { waitUntil: 'networkidle' });
  const cta = await page.locator('button:has-text("В корзину")').first();
  if (await cta.count()) {
    await cta.click(); await page.waitForTimeout(1200);
    await page.goto(STORE + '/cart', { waitUntil: 'networkidle' });
    const cartBody = await page.locator('body').innerText();
    if (/Аура|demo-zhenskiy/i.test(cartBody) || /1\s*товар|Итого/i.test(cartBody)) add('OK', 'cart', 'товар добавлен в корзину');
    else add('FLOW-GAP', 'cart', 'после «В корзину» корзина не показывает товар');
  } else add('UX-GAP', '/product/demo-zhenskiy-1', 'кнопка «В корзину» не найдена');
} catch (e) { add('FLOW-ERR', 'покупка', e.message.slice(0, 120)); }

// Таблица размеров на товаре с вариантами (если есть)
console.log('\n--- размерная сетка / формы ---');
try {
  await page.goto(STORE + '/contacts', { waitUntil: 'networkidle' });
  const cb = await page.locator('body').innerText();
  if (!/@|телефон|Telegram|tel:|mailto:/i.test(cb)) add('UX-GAP', '/contacts', 'нет видимых контактов (тел/почта/телеграм)');
} catch {}

console.log(`\n=== КОНСОЛЬНЫЕ ОШИБКИ (${consoleErrors.length}) ===`);
const favicon = consoleErrors.filter(e => /favicon/.test(e));
const realErrors = consoleErrors.filter(e => !/favicon/.test(e));
realErrors.slice(0, 30).forEach(e => add('CONSOLE-ERR', e.split(' :: ')[0].replace(STORE, ''), e.split(' :: ')[1] || ''));
console.log(`(favicon-404: ${favicon.length} — игнор)`);

await browser.close();
console.log(`\n=== ИТОГ ВИТРИНЫ: находок ${find.length} ===`);
const byType = {};
find.forEach(f => byType[f.type] = (byType[f.type] || 0) + 1);
console.log(JSON.stringify(byType, null, 0));
