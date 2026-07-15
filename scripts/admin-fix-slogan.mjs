// Правит слоган: тег «Fashion + Medicine» → «Comfort + Medicine» в блоке «О бренде»
// (поле #home-about-v) + сохраняет контент главной.
//   ADMIN_PASS=... node scripts/admin-fix-slogan.mjs
import { chromium } from 'playwright';
const ADMIN = process.env.ADMIN || 'https://admin.erfgq.website';
const PASS = process.env.ADMIN_PASS || '';
const USER = process.env.ADMIN_USER || 'admin';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1600 } })).newPage();

await page.goto(ADMIN + '/admin', { waitUntil: 'networkidle' });
if (await page.locator('input[type="password"]').count()) {
  await page.locator('input[name="email"], input[type="text"]').first().fill(USER);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
}
await page.goto(ADMIN + '/admin/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const values = page.locator('#home-about-v');
if (!(await values.count())) { console.log('FAIL: #home-about-v нет'); await browser.close(); process.exit(1); }
const before = await values.inputValue();
console.log('home-about-v ДО:', JSON.stringify(before));
const after = before.replace(/Fashion\s*\+\s*Medicine/gi, 'Comfort + Medicine');
if (after === before) { console.log('SKIP: «Fashion + Medicine» не найдено (возможно уже поправлено)'); }
await values.fill(after);
console.log('home-about-v ПОСЛЕ:', JSON.stringify(after));

// сохранить контент главной
const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const save = btns.find(b => /сохранить контент главной/i.test(b.textContent));
  if (save) { save.click(); return 'clicked:' + save.textContent.trim(); }
  return 'no-button';
});
console.log('save:', clicked);
await page.waitForTimeout(3000);

// перечитать
await page.goto(ADMIN + '/admin/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const check = await page.locator('#home-about-v').inputValue();
console.log('перечитано:', JSON.stringify(check));
console.log(/Comfort \+ Medicine/i.test(check) && !/Fashion/i.test(check) ? 'OK: слоган-тег обновлён' : 'CHECK');
await browser.close();
