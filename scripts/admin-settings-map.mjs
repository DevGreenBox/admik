// Карта полей страницы /admin/settings (что и где править).
import { chromium } from 'playwright';
const ADMIN = process.env.ADMIN || 'https://admin.erfgq.website';
const PASS = process.env.ADMIN_PASS || '';
const USER = process.env.ADMIN_USER || 'admin';
const TARGET = process.env.TARGET || '/admin/settings';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1200 } })).newPage();

await page.goto(ADMIN + '/admin', { waitUntil: 'networkidle' });
if (await page.locator('input[type="password"]').count()) {
  await page.locator('input[name="email"], input[type="text"]').first().fill(USER);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
}

await page.goto(ADMIN + TARGET, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
console.log('URL:', page.url());

// боковое оглавление настроек (секции)
const sections = await page.locator('a[href*="#"], nav a, aside a').evaluateAll(els =>
  [...new Set(els.map(e => (e.textContent||'').trim()).filter(Boolean))]);
console.log('\n=== СЕКЦИИ ===');
sections.slice(0, 30).forEach(s => console.log('  ' + s));

// все инпуты с их метками/именами/значениями
const fields = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('input, textarea, select').forEach(el => {
    const label = el.labels?.[0]?.textContent?.trim()
      || el.closest('label')?.textContent?.trim()
      || el.getAttribute('placeholder') || '';
    out.push({
      tag: el.tagName.toLowerCase(),
      name: el.getAttribute('name') || el.id || '',
      type: el.getAttribute('type') || '',
      label: label.slice(0, 50),
      value: (el.value || '').slice(0, 40),
    });
  });
  return out;
});
console.log(`\n=== ПОЛЯ (${fields.length}) ===`);
fields.forEach(f => console.log(`  [${f.type||f.tag}] name="${f.name}" label="${f.label}" value="${f.value}"`));

await browser.close();
