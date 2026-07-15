// Загружает фото к товарам ORDO/ALTERA (вкладка «Медиа»), помечает главным.
// Фото монтируются в контейнер по /photos. Идемпотентно: если у товара уже
// есть медиа — пропускает.
//   ADMIN_PASS=... node admin-upload-product-photos.mjs
import { chromium } from 'playwright';
const ADMIN = process.env.ADMIN || 'https://admin.erfgq.website';
const PASS = process.env.ADMIN_PASS || '';
const USER = process.env.ADMIN_USER || 'admin';

const ITEMS = [
  { url: ADMIN + '/admin/catalog/products/737cac36-85a5-40ef-b3d9-25900bcc96b7',
    file: '/photos/ordo-white-women.jpeg', alt: 'ORDO — женский медицинский костюм, белый' },
  { url: ADMIN + '/admin/catalog/products/df7347af-c970-430b-8505-124c6175d157',
    file: '/photos/altera-graphite-men.jpeg', alt: 'ALTERA — мужской медицинский костюм, графит' },
];

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 2200 } })).newPage();
await page.goto(ADMIN + '/admin', { waitUntil: 'networkidle' });
if (await page.locator('input[type="password"]').count()) {
  await page.locator('input[name="email"], input[type="text"]').first().fill(USER);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
}

for (const it of ITEMS) {
  console.log('\n=== ' + it.file + ' ===');
  await page.goto(it.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const tab = page.locator('button[role="tab"]:has-text("Медиа")');
  if (!(await tab.count())) { console.log('  ! вкладка «Медиа» недоступна'); continue; }
  await tab.click(); await page.waitForTimeout(800);
  // уже есть медиа? (идемпотентность)
  const hasMedia = await page.locator('img[alt]').count();
  const noMedia = await page.locator('text=Медиафайлов пока нет').count();
  if (hasMedia > 0 && noMedia === 0) { console.log('  = медиа уже есть, пропуск'); continue; }
  await page.locator('#m-file').setInputFiles(it.file);
  await page.locator('#m-alt').fill(it.alt);
  // чекбокс «главное фото», если есть
  const primary = page.locator('input[type="checkbox"]').first();
  if (await primary.count()) await primary.check().catch(() => {});
  await page.locator('button:has-text("Загрузить")').first().click();
  await page.waitForTimeout(4000);
  const err = await page.locator('[role="alert"]').first().textContent().catch(() => '');
  const imgs = await page.locator('img[alt]').count();
  console.log(err ? '  ! ошибка: ' + err.trim().slice(0, 80) : `  загружено, изображений: ${imgs}`);
}
await browser.close();
