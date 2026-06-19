// Спот-чек показа скидки на витрине (волна 14, фикс T6): товар с compareAtPrice
// должен показывать зачёркнутую старую цену + бейдж −N% в карточке и на странице.
import { chromium } from '@playwright/test';
const ADMIN = process.env.BASE || 'https://admin.erfgq.website';
const API = `${ADMIN}/api/storefront/v1`;
const STORE = process.env.STORE || 'https://erfgq.website';
const EMAIL = process.env.OWNER_EMAIL, PWD = process.env.OWNER_PASSWORD;
if (!EMAIL || !PWD) { console.error('NO_CREDS'); process.exit(2); }
const PREFIX = 'ZZ-W14-';
const log = (...a) => console.log(...a);
let pass = 0, fail = 0;
const P = (s, d = '') => { pass++; log(`[PASS] ${s}${d ? ' — ' + d : ''}`); };
const F = (s, d = '') => { fail++; log(`[FAIL] ${s}${d ? ' — ' + d : ''}`); };

const sf = async (p) => { const r = await fetch(`${API}${p}`, { headers: { origin: STORE } }); let b = null; try { b = await r.json(); } catch {} return { status: r.status, b }; };
const browser = await chromium.launch();
const admin = await browser.newPage();
let pid = null;
try {
  await admin.goto(`${ADMIN}/admin/login`, { waitUntil: 'networkidle' });
  await admin.fill('input[name="email"]', EMAIL); await admin.fill('input[name="password"]', PWD);
  await Promise.all([admin.waitForLoadState('networkidle'), admin.click('button[type="submit"]')]);
  await admin.waitForTimeout(1200);
  if (/\/admin\/login/.test(admin.url())) { F('login'); throw new Error('login'); }
  P('login');

  // создать товар со скидкой: цена 2000, старая 2500 (−20%)
  await admin.goto(`${ADMIN}/admin/catalog/products/new`, { waitUntil: 'networkidle' });
  await admin.fill('#p-name', `${PREFIX}Скидка`);
  await admin.fill('#p-price', '2000');
  await admin.selectOption('#p-status', 'active');
  await admin.locator('summary', { hasText: 'Дополнительные настройки' }).click();
  await admin.fill('#p-compare', '2500');
  await admin.click('button:has-text("Создать товар")');
  await admin.waitForURL(/\/admin\/catalog\/products\/[0-9a-f-]{36}/, { timeout: 25000 });
  pid = admin.url().match(/products\/([0-9a-f-]{36})/)[1];
  // остаток 5
  await admin.getByRole('tab', { name: 'Варианты' }).click(); await admin.waitForTimeout(400);
  const inp = admin.locator('input[type="number"]').first(); await inp.fill('5');
  await inp.locator('xpath=ancestor::tr').getByRole('button', { name: 'Сохранить' }).click();
  await admin.waitForTimeout(1500);
  P('товар со скидкой создан', pid);
  await admin.waitForTimeout(1500);

  // DTO: onSale + compareAtPrice
  const list = await sf('/products?limit=200');
  const item = (list.b?.data || []).find((i) => i.name === `${PREFIX}Скидка`);
  if (item) {
    const d = await sf(`/products/${item.slug}`);
    const dd = d.b?.data;
    if (dd?.onSale && dd?.compareAtPrice) P('DTO скидки', `onSale=${dd.onSale} old=${dd.compareAtPrice} now=${dd.price}`);
    else F('DTO скидки', `onSale=${dd?.onSale} compareAt=${dd?.compareAtPrice}`);

    // страница товара на витрине: зачёркнутая цена + бейдж %
    const sp = await (await browser.newContext()).newPage();
    await sp.goto(`${STORE}/product/${item.slug}`, { waitUntil: 'networkidle' });
    await sp.waitForTimeout(900);
    const hasStrike = await sp.locator('s, del, [class*="line-through"], .line-through').count();
    const body = (await sp.locator('body').innerText().catch(() => '')) || '';
    const hasPct = /−\d+\s*%|-\d+\s*%/.test(body);
    if (hasStrike > 0) P('страница товара: зачёркнутая старая цена видна', `${hasStrike} элем.`);
    else F('страница товара: зачёркнутая цена', 'не найдена');
    if (hasPct) P('страница товара: бейдж −N% виден'); else F('страница товара: бейдж %', 'не найден');

    // карточка в каталоге
    await sp.goto(`${STORE}/catalog`, { waitUntil: 'networkidle' });
    await sp.waitForTimeout(900);
    const cBody = (await sp.locator('body').innerText().catch(() => '')) || '';
    if (/2\s*500|2500/.test(cBody)) P('каталог: старая цена в карточке видна');
    else log('[INFO] каталог: старую цену в карточке не распознал (мог не попасть в первую страницу)');
  } else F('товар в листинге', 'не найден');
} catch (e) { F('FATAL', (e.message || '').slice(0, 120)); }
finally {
  // cleanup
  if (pid) {
    try {
      await admin.goto(`${ADMIN}/admin/catalog/products/${pid}`, { waitUntil: 'networkidle' });
      admin.once('dialog', (dlg) => dlg.accept().catch(() => {}));
      const b = admin.getByRole('button', { name: /Удалить навсегда/ }).first();
      if (await b.count()) { await b.click(); await admin.waitForTimeout(1800); log('[PASS] cleanup'); }
    } catch {}
  }
  await browser.close();
}
log(`\n===== ИТОГ DISCOUNT: PASS=${pass} FAIL=${fail} =====`);
process.exit(fail > 0 ? 1 : 0);
