// FAQ: в ответе «Как ухаживать за формой?» меняет «Стирка до 40 C» → «Стирка до 30 °C».
// Редактор FAQ-секции — одна textarea в формате «Вопрос|Ответ» (по строке на пару).
//   ADMIN_PASS=... node scripts/admin-fix-faq-care.mjs
import { chromium } from 'playwright';
const ADMIN = process.env.ADMIN || 'https://admin.erfgq.website';
const PASS = process.env.ADMIN_PASS || '';
const USER = process.env.ADMIN_USER || 'admin';
const FAQ_ID = '178904a8-2f8a-40ff-9366-e58ee5d65210';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1800 } })).newPage();

await page.goto(ADMIN + '/admin', { waitUntil: 'networkidle' });
if (await page.locator('input[type="password"]').count()) {
  await page.locator('input[name="email"], input[type="text"]').first().fill(USER);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
}
await page.goto(ADMIN + '/admin/cms/' + FAQ_ID, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

// раскрыть секцию FAQ
const edit = page.locator('button:has-text("Редактировать")').first();
if (await edit.count()) { await edit.click(); await page.waitForTimeout(1200); }

// textarea пар «Вопрос|Ответ»
const ta = page.locator('textarea[placeholder*="Вопрос|Ответ"]').first();
if (!(await ta.count())) { console.log('FAIL: textarea пар не найдена'); await browser.close(); process.exit(1); }
const before = await ta.inputValue();
console.log('содержит «40 C»:', /40\s*C/i.test(before));
// точечная замена именно в ответе про уход
const after = before
  .replace(/Стирка\s+до\s+40\s*C/gi, 'Стирка до 30 °C')
  .replace(/до\s+40\s*C/gi, 'до 30 °C');
if (after === before) { console.log('SKIP: «40 C» не найдено — возможно уже поправлено'); await browser.close(); process.exit(0); }
await ta.fill(after);
// покажем изменённую строку про уход
const line = after.split('\n').find(l => /ухаж/i.test(l)) || '';
console.log('строка ухода ПОСЛЕ:', JSON.stringify(line.slice(0, 160)));

// сохранить секцию
const saveSec = page.locator('button:has-text("Сохранить секцию")').first();
if (await saveSec.count()) { await saveSec.click(); await page.waitForTimeout(2500); console.log('«Сохранить секцию» нажата'); }
// сохранить страницу
const savePage = page.locator('button:has-text("Сохранить")').filter({ hasNotText: 'секцию' }).first();
if (await savePage.count()) { await savePage.click(); await page.waitForTimeout(3000); console.log('«Сохранить» (страница) нажата'); }

// перечитать
await page.goto(ADMIN + '/admin/cms/' + FAQ_ID, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const edit2 = page.locator('button:has-text("Редактировать")').first();
if (await edit2.count()) { await edit2.click(); await page.waitForTimeout(1000); }
const recheck = await page.locator('textarea[placeholder*="Вопрос|Ответ"]').first().inputValue();
console.log('после перечтения содержит «40 C»:', /40\s*C/i.test(recheck), '| «30 °C»:', /30\s*°?C/i.test(recheck));
console.log(!/40\s*C/i.test(recheck) && /30\s*°?C/i.test(recheck) ? 'OK: FAQ обновлён в админке' : 'CHECK');
await browser.close();
