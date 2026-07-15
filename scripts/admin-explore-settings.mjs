// Разведка админки: логин + карта разделов настроек/контента (для правок данных).
//   ADMIN=... ADMIN_PASS=... node scripts/admin-explore-settings.mjs
import { chromium } from 'playwright';
const ADMIN = process.env.ADMIN || 'https://admin.erfgq.website';
const PASS = process.env.ADMIN_PASS || '';
const USER = process.env.ADMIN_USER || '';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

await page.goto(ADMIN + '/admin', { waitUntil: 'networkidle' });
console.log('URL после /admin:', page.url());

// форма логина
const pwInput = page.locator('input[type="password"]').first();
if (await pwInput.count()) {
  const userInput = page.locator('input[type="email"], input[type="text"], input[name*="login" i], input[name*="user" i]').first();
  if (USER && await userInput.count()) await userInput.fill(USER);
  await pwInput.fill(PASS);
  const submit = page.locator('button[type="submit"], button').filter({ hasText: /вход|войти|log ?in|sign/i }).first();
  await submit.click().catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  console.log('URL после логина:', page.url());
}

const loggedIn = !/login|signin/i.test(page.url()) && !(await page.locator('input[type="password"]').count());
console.log('Залогинен:', loggedIn);

if (loggedIn) {
  // собрать пункты меню админки
  const nav = await page.locator('a[href^="/admin"]').evaluateAll(els =>
    [...new Set(els.map(e => `${(e.textContent||'').trim()} :: ${e.getAttribute('href')}`))].filter(x => x.split('::')[0].trim()));
  console.log('\n=== РАЗДЕЛЫ АДМИНКИ ===');
  nav.slice(0, 40).forEach(n => console.log('  ' + n));
}

await browser.close();
