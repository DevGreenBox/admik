// Заводит боевые товары ORDO (жен, белый) и ALTERA (муж, графит) как ЧЕРНОВИКИ
// (status=draft, цена 0 — проставит владелец), привязывает категорию и добавляет
// варианты-размеры из размерной сетки. Идемпотентно: если товар с таким name уже
// есть в списке — пропускает создание (но доводит варианты).
//   ADMIN_PASS=... node scripts/admin-seed-products.mjs
import { chromium } from 'playwright';
const ADMIN = process.env.ADMIN || 'https://admin.erfgq.website';
const PASS = process.env.ADMIN_PASS || '';
const USER = process.env.ADMIN_USER || 'admin';

// Модели из каталога Мадины + размерная сетка (razmernaya_setka.docx).
const PRODUCTS = [
  {
    name: 'ORDO — женский костюм, белый',
    slug: 'ordo-women-white',
    category: '— Женское',
    description:
      'Женский медицинский костюм ORDO. Поло с молнией (полуприлегающий крой) + прямые брюки. ' +
      'Цвет: белый. Рост 165–172 см. Премиальная ткань: держит цвет, устойчива к катышкам, ' +
      'эргономична и невесома. Уход: стирка до 30 °C без отбеливателя, глажка при средней температуре.',
    sizes: ['42 / XS', '44 / S', '46 / M', '48 / L'],
  },
  {
    name: 'ALTERA — мужской костюм, графит',
    slug: 'altera-men-graphite',
    category: '— Мужское',
    description:
      'Мужской медицинский костюм ALTERA. Верх с воротником-стойкой и асимметричной застёжкой ' +
      '(прямой / оверсайз) + прямые брюки. Цвет: графит. Рост 180–187 см. Премиальная ткань: ' +
      'держит цвет, устойчива к катышкам, эргономична и невесома. Уход: стирка до 30 °C без ' +
      'отбеливателя, глажка при средней температуре.',
    sizes: ['48 / M', '50 / L', '52 / XL', '54 / XXL'],
  },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 2200 } });
const page = await ctx.newPage();

async function login() {
  await page.goto(ADMIN + '/admin', { waitUntil: 'networkidle' });
  if (await page.locator('input[type="password"]').count()) {
    await page.locator('input[name="email"], input[type="text"]').first().fill(USER);
    await page.locator('input[type="password"]').first().fill(PASS);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
  }
}

async function existingProductHref(name) {
  await page.goto(ADMIN + '/admin/catalog/products', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  return await page.evaluate((nm) => {
    const links = [...document.querySelectorAll('a[href*="/admin/catalog/products/"]')]
      .filter((a) => !/\/new$/.test(a.getAttribute('href') || ''));
    const hit = links.find((a) => a.textContent.trim().toLowerCase().includes(nm.toLowerCase().slice(0, 12)));
    return hit ? hit.getAttribute('href') : null;
  }, name);
}

async function createProduct(pr) {
  await page.goto(ADMIN + '/admin/catalog/products/new', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.locator('#p-name').fill(pr.name);
  // статус draft — дефолт, но выставим явно
  await page.locator('#p-status').selectOption('draft').catch(() => {});
  await page.locator('#p-desc').fill(pr.description);
  // slug в доп.настройках (details) — раскроем
  const details = page.locator('summary:has-text("Дополнительные настройки")');
  if (await details.count()) { await details.click(); await page.waitForTimeout(400); }
  await page.locator('#p-slug').fill(pr.slug).catch(() => {});
  // категория: отметить чекбокс с подписью
  const catLabel = page.locator('fieldset label', { hasText: pr.category }).first();
  if (await catLabel.count()) {
    await catLabel.locator('input[type="checkbox"]').check().catch(() => {});
    // сделать основной, если появился radio
    await page.waitForTimeout(300);
    const radio = catLabel.locator('input[type="radio"]');
    if (await radio.count()) await radio.check().catch(() => {});
  }
  // создать
  await page.locator('button:has-text("Создать товар")').first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  const url = page.url();
  const ok = /\/admin\/catalog\/products\/[0-9a-f-]{8,}/.test(url);
  console.log(`  создан: ${ok} → ${url}`);
  return ok ? url : null;
}

async function addSizes(productUrl, sizes) {
  await page.goto(productUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // вкладка «Варианты»
  const tab = page.locator('button[role="tab"]:has-text("Варианты")');
  if (!(await tab.count())) { console.log('  ! вкладка «Варианты» недоступна'); return; }
  await tab.click(); await page.waitForTimeout(800);
  // уже существующие варианты (идемпотентность)
  const existing = await page.locator('table tbody tr td:first-child').allTextContents().catch(() => []);
  for (const size of sizes) {
    if (existing.some((e) => e.trim() === size)) { console.log(`    = ${size} уже есть`); continue; }
    await page.locator('#v-name').fill(size);
    await page.locator('button:has-text("Добавить вариант")').first().click();
    await page.waitForTimeout(1800);
    console.log(`    + ${size}`);
  }
}

await login();
for (const pr of PRODUCTS) {
  console.log(`\n=== ${pr.name} ===`);
  let url = await existingProductHref(pr.name);
  if (url) {
    if (!url.startsWith('http')) url = ADMIN + url;
    console.log('  уже существует →', url, '(создание пропущено)');
  } else {
    url = await createProduct(pr);
  }
  if (url) await addSizes(url, pr.sizes);
}

// финальная сверка
await page.goto(ADMIN + '/admin/catalog/products', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const names = await page.locator('a[href*="/admin/catalog/products/"]').allTextContents();
console.log('\n=== ИТОГ: товары в списке ===');
console.log([...new Set(names.map((n) => n.trim()).filter(Boolean))].join('\n'));
await browser.close();
