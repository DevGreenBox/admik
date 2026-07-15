// Живая проверка багов чекаута (правки Ани2 #7/#8) на проде.
//   STORE=... node scripts/verify-checkout-fixes.mjs
import { chromium } from 'playwright';
const STORE = process.env.STORE || 'https://erfgq.website';
const out = [];
const rec = (id, ok, note) => { out.push({ id, ok }); console.log(`[${ok ? 'OK' : 'FAIL'}] ${id} — ${note}`); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

// найти товар и добавить в корзину
await page.goto(STORE + '/catalog', { waitUntil: 'networkidle' });
const prod = await page.locator('a[href^="/product/"]').first().getAttribute('href');
await page.goto(STORE + prod, { waitUntil: 'networkidle' });
// выбрать размер если есть
const sizeBtn = page.locator('button').filter({ hasText: /^(XS|S|M|L|XL|XXL|42|44|46|48|50|52|54)$/ }).first();
if (await sizeBtn.count()) await sizeBtn.click().catch(() => {});
const addBtn = page.locator('button').filter({ hasText: /в корзину/i }).first();
if (await addBtn.count()) { await addBtn.click(); await page.waitForTimeout(1500); }

await page.goto(STORE + '/checkout', { waitUntil: 'networkidle' });
const phone = page.locator('input[type="tel"]').first();
if (await phone.count()) {
  // #8 маска: пробуем ввести 15 девяток
  await phone.fill('');
  await phone.type('999999999999999', { delay: 5 });
  const val = await phone.inputValue();
  const digits = (val.match(/\d/g) || []).length;
  rec('А2в8 маска телефона ≤11 цифр', digits <= 11, `после 15 девяток: "${val}" (${digits} цифр)`);

  // #7 подсветка: очистить обязательные поля, нажать «Далее»
  const nameInput = page.locator('input[type="text"]').first();
  await nameInput.fill('').catch(() => {});
  const nextBtn = page.locator('button').filter({ hasText: /далее/i }).first();
  await nextBtn.click().catch(() => {});
  await page.waitForTimeout(600);
  const redFields = await page.locator('[aria-invalid="true"], .border-red-500').count();
  const errMsg = await page.locator('.text-red-600, .text-red-500').count();
  rec('А2в7 подсветка незаполненных полей', redFields > 0 || errMsg > 0, `красных полей: ${redFields}, сообщений: ${errMsg}`);
} else {
  rec('чекаут форма', false, 'поле телефона не найдено (корзина пуста?)');
}

await browser.close();
const failed = out.filter(o => !o.ok).length;
console.log(`\n=== ИТОГ: ${out.length - failed}/${out.length} ok ===`);
process.exit(failed > 0 ? 1 : 0);
