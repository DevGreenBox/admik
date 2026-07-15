// Скрывает демо-товары: выделяет в списке все товары КРОМЕ ORDO/ALTERA и
// отправляет их в архив (bulk «В архив»). Обратимо (можно вернуть «Опубликовать»).
//   ADMIN_PASS=... node admin-archive-demo.mjs
import { chromium } from 'playwright';
const ADMIN = process.env.ADMIN || 'https://admin.erfgq.website';
const PASS = process.env.ADMIN_PASS || '';
const USER = process.env.ADMIN_USER || 'admin';
const KEEP = /ORDO|ALTERA/i; // реальные товары — не трогать

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 2400 } })).newPage();
page.on('dialog', (d) => d.accept()); // подтверждать «В архив»

await page.goto(ADMIN + '/admin', { waitUntil: 'networkidle' });
if (await page.locator('input[type="password"]').count()) {
  await page.locator('input[name="email"], input[type="text"]').first().fill(USER);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
}
await page.goto(ADMIN + '/admin/catalog', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// собрать все строки товаров: имя + статус
const rows = await page.evaluate(() => {
  return [...document.querySelectorAll('tbody tr')].map((tr) => {
    const nameLink = tr.querySelector('a[href*="/admin/catalog/products/"]');
    const cb = tr.querySelector('input[type="checkbox"][aria-label^="Выбрать товар"]');
    return {
      name: nameLink?.textContent?.trim() || '',
      status: tr.textContent.includes('Активен') ? 'active'
        : tr.textContent.includes('Черновик') ? 'draft'
        : tr.textContent.includes('архив') ? 'archived' : '?',
      aria: cb?.getAttribute('aria-label') || '',
    };
  }).filter((r) => r.name);
});
console.log('=== товары в списке ('+rows.length+') ===');
rows.forEach((r) => console.log(`  [${r.status}] ${r.name}`));

const toArchive = rows.filter((r) => !KEEP.test(r.name) && r.status !== 'archived');
console.log('\n=== в архив ('+toArchive.length+') ===');
toArchive.forEach((r) => console.log('  '+r.name));
if (toArchive.length === 0) { console.log('нечего архивировать'); await browser.close(); process.exit(0); }

// отметить чекбоксы этих строк
for (const r of toArchive) {
  const cb = page.locator(`input[aria-label="${r.aria.replace(/"/g, '\\"')}"]`).first();
  if (await cb.count()) await cb.check().catch(() => {});
}
await page.waitForTimeout(500);
const selCount = await page.locator('text=/Выбрано:/').textContent().catch(() => '');
console.log('панель выбора:', selCount.trim());

// нажать «В архив»
await page.locator('button:has-text("В архив")').first().click();
await page.waitForTimeout(4000);

// сверка
await page.goto(ADMIN + '/admin/catalog', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const after = await page.evaluate(() => [...document.querySelectorAll('tbody tr')].map((tr) => {
  const n = tr.querySelector('a[href*="/admin/catalog/products/"]')?.textContent?.trim() || '';
  const st = tr.textContent.includes('Активен') ? 'active' : tr.textContent.includes('Черновик') ? 'draft' : tr.textContent.includes('архив') ? 'archived' : '?';
  return n ? `[${st}] ${n}` : '';
}).filter(Boolean));
console.log('\n=== ПОСЛЕ ==='); after.forEach((x) => console.log('  '+x));
await browser.close();
