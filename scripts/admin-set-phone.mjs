// Вписывает телефон в /admin/settings (секция контактов, поле #ct-phone — по ID!)
// и сохраняет кнопкой секции. Поля идентифицируются по id (name отсутствует).
//   ADMIN_PASS=... PHONE="+7 (982) 510-31-76" node scripts/admin-set-phone.mjs
import { chromium } from 'playwright';
const ADMIN = process.env.ADMIN || 'https://admin.erfgq.website';
const PASS = process.env.ADMIN_PASS || '';
const USER = process.env.ADMIN_USER || 'admin';
const PHONE = process.env.PHONE || '+7 (982) 510-31-76';
const EMAIL = process.env.EMAIL || '';
const ADDR = process.env.ADDR || '';

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

const phone = page.locator('#ct-phone');
if (!(await phone.count())) { console.log('FAIL: #ct-phone не найдено'); await browser.close(); process.exit(1); }
console.log('ct-phone ДО:', JSON.stringify(await phone.inputValue()));
await phone.fill(PHONE);
if (EMAIL) { const f = page.locator('#ct-email'); if (await f.count()) await f.fill(EMAIL); }
if (ADDR) { const f = page.locator('#ct-addr'); if (await f.count()) await f.fill(ADDR); }
console.log('вписал телефон:', PHONE, EMAIL ? '| email: ' + EMAIL : '', ADDR ? '| адрес: ' + ADDR : '');

// Кнопка сохранения секции контактов: ищем по ID поля вверх до контейнера с кнопкой «Сохранить …контакт…»
const clicked = await page.evaluate(() => {
  const inp = document.getElementById('ct-phone');
  if (!inp) return 'no-input';
  let node = inp;
  for (let i = 0; i < 10 && node; i++) {
    node = node.parentElement;
    if (!node) break;
    const btns = [...node.querySelectorAll('button')];
    // приоритет — кнопка со словом «контакт», иначе любая «Сохранить»
    const save = btns.find(b => /сохранить.*контакт/i.test(b.textContent))
             || btns.find(b => /^сохранить/i.test(b.textContent.trim()));
    if (save) { save.click(); return 'clicked:' + save.textContent.trim(); }
  }
  return 'no-save-button';
});
console.log('save:', clicked);
await page.waitForTimeout(3000);

await page.goto(ADMIN + '/admin/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const after = await page.locator('#ct-phone').inputValue();
console.log('ct-phone ПОСЛЕ:', JSON.stringify(after));
console.log(after.includes('982') ? 'OK: сохранено' : 'FAIL: не сохранилось');
await browser.close();
