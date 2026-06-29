// ============================================================================
// Живая проверка B9 «однопользовательский режим» на стенде (Playwright).
// Креды — ТОЛЬКО через env, не печатать:
//   export OWNER_EMAIL=...; export OWNER_PASSWORD=...
//   node scripts/verify-b9-single-user.mjs
// Предусловие: на стенде включён режим (shop_settings.access.singleUserMode=true).
// Проверяет: логин → меню без «Пользователи»/«Роли» → guard-страницы users/roles
// отдают заглушку → раздел «Доступ» в настройках доступен (можно выключить режим).
// ============================================================================
import { chromium } from '@playwright/test';

const ADMIN = process.env.BASE || 'https://admin.erfgq.website';
const EMAIL = process.env.OWNER_EMAIL, PWD = process.env.OWNER_PASSWORD;
if (!EMAIL || !PWD) { console.error('NO_CREDS — задай OWNER_EMAIL/OWNER_PASSWORD'); process.exit(2); }

const out = [];
const P = (s, d = '') => { out.push('PASS'); console.log('[PASS] ' + s + (d ? ' — ' + d : '')); };
const F = (s, d = '') => { out.push('FAIL'); console.log('[FAIL] ' + s + (d ? ' — ' + d : '')); };

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(`${ADMIN}/admin/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PWD);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
  if (/\/admin\/login/.test(page.url())) { F('login', 'остались на /admin/login'); }
  else {
    P('login', 'вошли в админку');
    await page.goto(`${ADMIN}/admin`, { waitUntil: 'networkidle' });
    const hrefs = await page.locator('a[href]').evaluateAll(els => els.map(e => e.getAttribute('href')));
    hrefs.includes('/admin/users') ? F('меню: /admin/users присутствует (должна быть скрыта)') : P('меню: «Пользователи» скрыт');
    hrefs.includes('/admin/roles') ? F('меню: /admin/roles присутствует (должна быть скрыта)') : P('меню: «Роли» скрыт');
    hrefs.includes('/admin/settings') ? P('меню: «Настройки» на месте (core)') : F('меню: «Настройки» пропали');

    await page.goto(`${ADMIN}/admin/users`, { waitUntil: 'networkidle' });
    const ub = await page.locator('body').innerText();
    /Однопользовательский режим/.test(ub) ? P('/admin/users → заглушка SingleUserModeNotice') : F('/admin/users → нет заглушки', ub.slice(0, 140).replace(/\n/g, ' '));

    await page.goto(`${ADMIN}/admin/roles`, { waitUntil: 'networkidle' });
    const rb = await page.locator('body').innerText();
    /Однопользовательский режим/.test(rb) ? P('/admin/roles → заглушка') : F('/admin/roles → нет заглушки', rb.slice(0, 140).replace(/\n/g, ' '));

    await page.goto(`${ADMIN}/admin/settings`, { waitUntil: 'networkidle' });
    const sb = await page.locator('body').innerText();
    /Однопользовательский режим/.test(sb) ? P('настройки → раздел «Доступ» с переключателем виден') : F('настройки → нет раздела «Доступ»');

    await page.goto(`${ADMIN}/admin`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'b9-admin-nav.jpeg', type: 'jpeg', quality: 85 });
  }
} catch (e) { F('exception', e.message); }
await browser.close();
const fails = out.filter(r => r === 'FAIL').length;
console.log(`\n=== B9 LIVE: PASS=${out.filter(r => r === 'PASS').length} FAIL=${fails} ===`);
process.exit(fails ? 1 : 0);
