// Живой аудит АДМИНКИ глазами владельца (нетех): тупики/ошибки/недочёты.
// Логин (creds из env, не печатать) → обход всех разделов → консольные ошибки,
// статус рендера, битые картинки, ссылки-в-никуда (вкл. дангл на /admin/users|roles
// при однопольз. режиме), доступность ключевых действий. node scripts/audit-admin-live.mjs
import { chromium } from '@playwright/test';
const ADMIN = process.env.BASE || 'https://admin.erfgq.website';
const EMAIL = process.env.OWNER_EMAIL, PWD = process.env.OWNER_PASSWORD;
if (!EMAIL || !PWD) { console.error('NO_CREDS'); process.exit(2); }
const find = [];
const add = (type, where, detail) => { find.push({ type, where, detail }); console.log(`[${type}] ${where} — ${detail}`); };

const SECTIONS = [
  // список товаров — на /admin/catalog (НЕ /admin/catalog/products — там нет page.tsx, 404).
  '/admin', '/admin/catalog', '/admin/catalog/products/new',
  '/admin/catalog/categories', '/admin/catalog/brands', '/admin/catalog/brands/new',
  '/admin/catalog/attributes', '/admin/orders', '/admin/orders/new', '/admin/promo',
  '/admin/promo/new', '/admin/leads', '/admin/subscribers', '/admin/cdek', '/admin/cms',
  '/admin/cms/new', '/admin/settings', '/admin/settings/seo', '/admin/audit', '/admin/account',
  '/admin/users', '/admin/roles',
];

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const consoleByUrl = {};
page.on('console', m => { if (m.type() === 'error') { const u = page.url().replace(ADMIN, ''); (consoleByUrl[u] ||= []).push(m.text()); } });
page.on('pageerror', e => { const u = page.url().replace(ADMIN, ''); (consoleByUrl[u] ||= []).push('PAGEERROR ' + e.message); });

// login
await page.goto(`${ADMIN}/admin/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PWD);
await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
await page.waitForTimeout(1500);
if (/\/admin\/login/.test(page.url())) { add('BLOCKER', 'login', 'не удалось войти'); await browser.close(); process.exit(1); }
add('OK', 'login', 'вошли');

const adminLinks = new Set();
for (const r of SECTIONS) {
  let resp;
  try { resp = await page.goto(ADMIN + r, { waitUntil: 'networkidle', timeout: 25000 }); }
  catch (e) { add('NAV-ERR', r, e.message.slice(0, 120)); continue; }
  const status = resp ? resp.status() : 0;
  if (status >= 500) { add('HTTP-5xx', r, `статус ${status}`); continue; }
  const body = await page.locator('body').innerText();
  // признаки тупика/ошибки на странице
  if (/Application error|Internal Server Error|Unhandled|TypeError|ReferenceError|чёт пошло не так|Что-то пошло/i.test(body)) add('PAGE-ERROR', r, 'на странице видна ошибка приложения');
  if (/Доступ к разделу закрыт/i.test(body)) add('FORBIDDEN', r, 'раздел отдаёт 403 (нет права у владельца?)');
  const single = /Однопользовательский режим/.test(body);
  if ((r === '/admin/users' || r === '/admin/roles')) {
    single ? add('OK', r, 'заглушка однопольз. режима (ожидаемо)') : add('UX-GAP', r, 'нет заглушки (ожидали при включённом режиме)');
  }
  // битые картинки
  const broken = await page.locator('img').evaluateAll(imgs => imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.currentSrc || i.src));
  for (const b of broken.slice(0, 4)) add('BROKEN-IMG', r, b);
  // собрать админ-ссылки
  const hrefs = await page.locator('a[href^="/admin"]').evaluateAll(els => els.map(e => e.getAttribute('href')));
  hrefs.forEach(h => h && adminLinks.add(h.split('#')[0].split('?')[0]));
}

// дангл-ссылки на скрытые разделы (тупик: ведут на заглушку)
console.log('\n--- проверка админ-ссылок на дангл/битость ---');
for (const h of adminLinks) {
  if ((h === '/admin/users' || h === '/admin/roles')) {
    add('DANGLING-LINK', h, 'где-то в UI есть ссылка на скрытый раздел (ведёт на заглушку) — потенциальный тупик');
  }
}

// Открыть карточку demo-товара (управляемость из админки)
console.log('\n--- управляемость каталога ---');
try {
  await page.goto(`${ADMIN}/admin/catalog`, { waitUntil: 'networkidle' });
  const anyProd = page.locator('a[href*="/admin/catalog/products/"]').first();
  if (await anyProd.count()) {
    await anyProd.click(); await page.waitForTimeout(1500);
    const pb = await page.locator('body').innerText();
    if (/TypeError|Application error|Что-то пошло/i.test(pb)) add('PAGE-ERROR', 'product-edit', 'карточка товара с ошибкой');
    else add('OK', 'product-edit', 'карточка товара открывается');
  } else add('UX-GAP', '/admin/catalog', 'не нашёл ни одной ссылки на товар в списке');
} catch (e) { add('FLOW-ERR', 'product-edit', e.message.slice(0, 120)); }

// Категории: видны ли zhenskie/muzhskie, управляемы ли
try {
  await page.goto(`${ADMIN}/admin/catalog/categories`, { waitUntil: 'networkidle' });
  const cb = await page.locator('body').innerText();
  if (!/Женское|Мужское/.test(cb)) add('UX-GAP', '/admin/catalog/categories', 'новые подкатегории Женское/Мужское не видны в менеджере категорий');
  else add('OK', 'categories', 'подкатегории видны в менеджере');
  if (/test 123|test 12333/.test(cb)) add('LEFTOVER', '/admin/catalog/categories', 'мусорные категории всё ещё видны');
} catch (e) { add('FLOW-ERR', 'categories', e.message.slice(0, 120)); }

// Настройки: раздел Доступ + сохранение (НЕ меняем, только наличие переключателя)
try {
  await page.goto(`${ADMIN}/admin/settings`, { waitUntil: 'networkidle' });
  const sb = await page.locator('body').innerText();
  if (!/Однопользовательский режим/.test(sb)) add('UX-GAP', '/admin/settings', 'нет раздела «Доступ»');
  else add('OK', 'settings-access', 'раздел «Доступ» на месте');
} catch {}

// консольные ошибки (фильтр favicon)
console.log('\n=== КОНСОЛЬНЫЕ ОШИБКИ ПО СТРАНИЦАМ ===');
for (const [u, errs] of Object.entries(consoleByUrl)) {
  const real = errs.filter(e => !/favicon/.test(e));
  real.slice(0, 4).forEach(e => add('CONSOLE-ERR', u, e.slice(0, 160)));
}

await browser.close();
console.log(`\n=== ИТОГ АДМИНКИ: находок ${find.length} ===`);
const byType = {};
find.forEach(f => byType[f.type] = (byType[f.type] || 0) + 1);
console.log(JSON.stringify(byType));
