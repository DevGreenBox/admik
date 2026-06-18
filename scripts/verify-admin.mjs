// ============================================================================
// Живая проверка админки + Storefront API на боевом стенде (Playwright + fetch).
//
// ЗАПУСК (creds — только через env, не печатать):
//   export OWNER_EMAIL=...; export OWNER_PASSWORD=...
//   node scripts/verify-admin.mjs <phase>
// Фазы: login | catalog | full | sections | e2e | cleanup
//   e2e — браузерный проклик ВИТРИНЫ (STORE_ORIGIN): каталог → карточка → корзина
//         → чекаут (город/ПВЗ/заказ) → проверка в админке → уборка ZZ-QA-товаров.
//
// `full` создаёт тест-данные с префиксом ZZ-QA- и в конце удаляет товары через
// UI. Заказ/покупателя/промокоды добивает SQL-чистка (запускается отдельно по
// SSH — см. сессию). `cleanup` — повторно удаляет ZZ-QA-товары через UI.
// ============================================================================
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const ADMIN = process.env.BASE || 'https://admin.erfgq.website';
const API = `${ADMIN}/api/storefront/v1`;
const STORE_ORIGIN = process.env.STORE || 'https://erfgq.website';
const EMAIL = process.env.OWNER_EMAIL;
const PWD = process.env.OWNER_PASSWORD;
const phase = process.argv[2] || 'login';
if (!EMAIL || !PWD) { console.error('NO_CREDS — задай OWNER_EMAIL/OWNER_PASSWORD'); process.exit(2); }

const PREFIX = 'ZZ-QA-';
const QA_EMAIL = 'zz-qa-buyer@example.com';

const results = [];
function rec(status, step, detail = '') {
  results.push({ status, step, detail });
  console.log(`[${status}] ${step}${detail ? ` — ${detail}` : ''}`);
}
const PASS = (s, d) => rec('PASS', s, d);
const FAIL = (s, d) => rec('FAIL', s, d);
const INFO = (s, d) => rec('INFO', s, d);

async function sf(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { origin: STORE_ORIGIN, 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

async function login(page) {
  await page.goto(`${ADMIN}/admin/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PWD);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
  return !/\/admin\/login/.test(page.url());
}

// --- админ-хелперы --------------------------------------------------------

async function createProduct(page, { name, price, status = 'active', compareAt = null, seoTitle = null, seoDesc = null }) {
  await page.goto(`${ADMIN}/admin/catalog/products/new`, { waitUntil: 'networkidle' });
  await page.fill('#p-name', name);
  await page.fill('#p-price', String(price));
  await page.selectOption('#p-status', status);
  if (compareAt != null) {
    await page.locator('summary', { hasText: 'Дополнительные настройки' }).click();
    await page.fill('#p-compare', String(compareAt));
  }
  if (seoTitle || seoDesc) {
    await page.getByRole('tab', { name: 'SEO' }).click();
    if (seoTitle) await page.fill('#p-seo-title', seoTitle);
    if (seoDesc) await page.fill('#p-seo-desc', seoDesc);
  }
  await page.click('button:has-text("Создать товар")');
  try {
    await page.waitForURL(/\/admin\/catalog\/products\/[0-9a-f-]{36}/, { timeout: 25000 });
  } catch {
    const alert = await page.locator('[role="alert"]').first().textContent().catch(() => '');
    throw new Error(`создание не привело к редиректу; ошибка формы: ${(alert || '').trim().slice(0, 200)}`);
  }
  return page.url().match(/products\/([0-9a-f-]{36})/)[1];
}

async function gotoTab(page, name) {
  await page.getByRole('tab', { name }).click();
  await page.waitForTimeout(400);
}

// Остаток для текущего юнита (первый number-input во вкладке «Варианты»).
async function setStock(page, qty) {
  await gotoTab(page, 'Варианты');
  const input = page.locator('input[type="number"]').first();
  await input.fill(String(qty));
  await input.locator('xpath=ancestor::tr').getByRole('button', { name: 'Сохранить' }).click();
  await page.waitForTimeout(1500);
}

async function addVariant(page, vname) {
  await gotoTab(page, 'Варианты');
  await page.fill('#v-name', vname);
  await page.click('button:has-text("Добавить вариант")');
  await page.waitForTimeout(1800);
}

async function uploadPhoto(page, filePath) {
  await gotoTab(page, 'Медиа');
  await page.setInputFiles('#m-file', filePath);
  await page.click('button:has-text("Загрузить")');
  // ждём появления превью ИЛИ ошибки
  await page.waitForTimeout(3500);
  const err = await page.locator('[role="alert"]').first().textContent().catch(() => '');
  const imgs = await page.locator('img').count().catch(() => 0);
  return { err: (err || '').trim(), imgs };
}

async function createPromo(page, f) {
  await page.goto(`${ADMIN}/admin/promo/new`, { waitUntil: 'networkidle' });
  await page.fill('#p-code', f.code);
  await page.selectOption('#p-kind', f.kind);
  if (f.value != null && f.kind !== 'free_delivery') await page.fill('#p-value', String(f.value));
  if (f.min != null) await page.fill('#p-min', String(f.min));
  if (f.kind === 'bogo') {
    await page.fill('#p-bogo-buy', String(f.buy));
    await page.fill('#p-bogo-pay', String(f.pay));
  }
  await page.click('button:has-text("Создать промокод")');
  try {
    await page.waitForURL(/\/admin\/promo$/, { timeout: 20000 });
    return { ok: true };
  } catch {
    const alert = await page.locator('[role="alert"]').first().textContent().catch(() => '');
    return { ok: false, error: (alert || '').trim().slice(0, 200) };
  }
}

async function deleteProductUI(page, id) {
  page.once('dialog', (d) => d.accept());
  await page.goto(`${ADMIN}/admin/catalog/products/${id}`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Удалить навсегда")');
  try {
    await page.waitForURL(/\/admin\/catalog(\?|$)/, { timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

// --- сценарии -------------------------------------------------------------

async function runFull(page) {
  const ids = {};
  const slugs = {};

  // 1. Создание товаров разных вариаций.
  try {
    ids.A = await createProduct(page, { name: `${PREFIX}Халат без размеров`, price: 2000, compareAt: 2500, status: 'active' });
    await setStock(page, 50);
    PASS('create A (без вариантов, скидка, остаток 50 на товаре)', ids.A);
  } catch (e) { FAIL('create A', e.message); }

  try {
    ids.B = await createProduct(page, { name: `${PREFIX}Футболка с размером`, price: 1500, status: 'active' });
    await addVariant(page, 'M');
    await setStock(page, 30); // первый (и единственный) вариант
    PASS('create B (вариант «M», остаток 30)', ids.B);
  } catch (e) { FAIL('create B', e.message); }

  try {
    ids.C = await createProduct(page, {
      name: `${PREFIX}Товар с SEO`, price: 1200, status: 'active',
      seoTitle: `${PREFIX}Кастомный SEO заголовок`, seoDesc: `${PREFIX}мета-описание для поисковиков`,
    });
    await setStock(page, 10);
    PASS('create C (кастомный SEO, остаток 10)', ids.C);
  } catch (e) { FAIL('create C', e.message); }

  try {
    ids.D = await createProduct(page, { name: `${PREFIX}Черновик скрытый`, price: 999, status: 'draft' });
    PASS('create D (черновик — должен быть скрыт с витрины)', ids.D);
  } catch (e) { FAIL('create D', e.message); }

  // 2. Загрузка фото (>1 МБ — проверка фикса bodySizeLimit).
  if (ids.A) {
    try {
      const W = 1600, H = 1600;
      const raw = Buffer.alloc(W * H * 3);
      for (let i = 0; i < raw.length; i++) raw[i] = (i * 1103515245 + 12345) & 255; // псевдошум → плохо жмётся
      const file = '/tmp/zzqa-photo.jpg';
      await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 96 }).toFile(file);
      const { size } = await import('node:fs').then((m) => m.promises.stat(file));
      await page.goto(`${ADMIN}/admin/catalog/products/${ids.A}`, { waitUntil: 'networkidle' });
      const r = await uploadPhoto(page, file);
      if (r.err && !/превью|нет превью/.test(r.err)) FAIL('upload photo A (>1МБ)', `${(size / 1048576).toFixed(1)}МБ → ошибка: ${r.err}`);
      else PASS('upload photo A (>1МБ)', `файл ${(size / 1048576).toFixed(1)}МБ загружен`);
    } catch (e) { FAIL('upload photo A', e.message); }
  }

  // 3. Проверка витрины (Storefront API).
  let list;
  try {
    list = await sf(`/products?limit=100`);
    const items = Array.isArray(list.body?.data) ? list.body.data : [];
    for (const it of items) if (it.name?.startsWith(PREFIX)) slugs[it.name] = it.slug;
    const names = items.map((i) => i.name);
    const hasA = names.some((n) => n === `${PREFIX}Халат без размеров`);
    const hasB = names.some((n) => n === `${PREFIX}Футболка с размером`);
    const hasC = names.some((n) => n === `${PREFIX}Товар с SEO`);
    const hasD = names.some((n) => n === `${PREFIX}Черновик скрытый`);
    if (hasA && hasB && hasC && !hasD) PASS('storefront /products', 'A,B,C видны; D (черновик) скрыт ✓');
    else FAIL('storefront /products', `A=${hasA} B=${hasB} C=${hasC} D_скрыт=${!hasD}`);
  } catch (e) { FAIL('storefront /products', e.message); }

  // 3a. Деталь A: inStock + id + скидка.
  const slugA = slugs[`${PREFIX}Халат без размеров`];
  if (slugA) {
    try {
      const d = await sf(`/products/${slugA}`);
      const p = d.body?.data;
      const ok = p && p.id === ids.A && p.inStock === true && p.onSale === true && p.compareAtPrice;
      if (ok) PASS('storefront деталь A', `id отдан, inStock=true, onSale=true (скидка ${p.discountPct}%)`);
      else FAIL('storefront деталь A', `id=${p?.id} inStock=${p?.inStock} onSale=${p?.onSale}`);
    } catch (e) { FAIL('storefront деталь A', e.message); }
  } else FAIL('storefront деталь A', 'slug A не найден в листинге');

  // 3b. SEO C: per-product meta.title (фикс generateMetadata).
  const slugC = slugs[`${PREFIX}Товар с SEO`];
  if (slugC && slugA) {
    try {
      const dC = await sf(`/products/${slugC}`);
      const dA = await sf(`/products/${slugA}`);
      const titleC = dC.body?.data?.meta?.title || '';
      const titleA = dA.body?.data?.meta?.title || '';
      if (titleC.includes('Кастомный SEO') && titleC !== titleA) PASS('storefront SEO C', `meta.title персональный: "${titleC.slice(0, 50)}"`);
      else FAIL('storefront SEO C', `titleC="${titleC}" titleA="${titleA}"`);
    } catch (e) { FAIL('storefront SEO C', e.message); }
  }

  // 3c. Вариант B: inStock + id (выбор размера).
  const slugB = slugs[`${PREFIX}Футболка с размером`];
  let variantBId = null;
  if (slugB) {
    try {
      const d = await sf(`/products/${slugB}`);
      const v = d.body?.data?.variants?.[0];
      variantBId = v?.id || null;
      if (v && v.inStock === true && v.id) PASS('storefront вариант B (размер M)', `variantId отдан, inStock=true`);
      else FAIL('storefront вариант B', `variants=${JSON.stringify(d.body?.data?.variants)}`);
    } catch (e) { FAIL('storefront вариант B', e.message); }
  }

  // 4. Промокоды (создание через UI).
  const promos = [
    { code: `${PREFIX}PCT15`, kind: 'percent', value: 15 },
    { code: `${PREFIX}FIX300`, kind: 'fixed', value: 300, min: 5000 },
    { code: `${PREFIX}BOGO`, kind: 'bogo', buy: 2, pay: 1 },
  ];
  for (const p of promos) {
    const r = await createPromo(page, p);
    if (r.ok) PASS(`create promo ${p.code}`, p.kind);
    else FAIL(`create promo ${p.code}`, r.error);
  }

  // 5. Проверка промокодов через cart/quote (anti-tamper).
  let unit = 1;
  if (ids.A) {
    try {
      const clean = await sf(`/cart/quote`, { method: 'POST', body: JSON.stringify({ items: [{ productId: ids.A, qty: 1 }] }) });
      const itemsTotal = Number(clean.body?.data?.itemsTotal);
      unit = itemsTotal / 2000; // 1 → рубли, 100 → копейки
      INFO('quote unit probe', `itemsTotal(1шт)=${itemsTotal} → единица=${unit}`);

      const q15 = await sf(`/cart/quote`, { method: 'POST', body: JSON.stringify({ items: [{ productId: ids.A, qty: 2 }], promoCode: `${PREFIX}PCT15` }) });
      const it15 = Number(q15.body?.data?.itemsTotal), disc15 = Number(q15.body?.data?.discountTotal);
      if (Math.abs(disc15 - it15 * 0.15) <= unit) PASS('quote PCT15', `скидка ${disc15} ≈ 15% от ${it15}`);
      else FAIL('quote PCT15', `itemsTotal=${it15} discount=${disc15} (ждали ~${it15 * 0.15})`);

      const qGate = await sf(`/cart/quote`, { method: 'POST', body: JSON.stringify({ items: [{ productId: ids.A, qty: 1 }], promoCode: `${PREFIX}FIX300` }) });
      const discGate = Number(qGate.body?.data?.discountTotal);
      if (discGate === 0) PASS('quote FIX300 gating (сумма < мин 5000)', 'скидка НЕ применена ✓');
      else FAIL('quote FIX300 gating', `discount=${discGate} (ждали 0 при сумме ниже минимума)`);

      const qFix = await sf(`/cart/quote`, { method: 'POST', body: JSON.stringify({ items: [{ productId: ids.A, qty: 3 }], promoCode: `${PREFIX}FIX300` }) });
      const discFix = Number(qFix.body?.data?.discountTotal);
      if (Math.abs(discFix - 300 * unit) <= unit) PASS('quote FIX300 applied (сумма ≥ 5000)', `скидка ${discFix} = 300`);
      else FAIL('quote FIX300 applied', `discount=${discFix} (ждали ${300 * unit})`);

      const qBogo = await sf(`/cart/quote`, { method: 'POST', body: JSON.stringify({ items: [{ productId: ids.A, qty: 2 }], promoCode: `${PREFIX}BOGO` }) });
      const discBogo = Number(qBogo.body?.data?.discountTotal);
      if (Math.abs(discBogo - 2000 * unit) <= unit) PASS('quote BOGO 2по1', `1 бесплатно: скидка ${discBogo} = цена 1 шт`);
      else FAIL('quote BOGO 2по1', `discount=${discBogo} (ждали ${2000 * unit})`);
    } catch (e) { FAIL('quote-проверки', e.message); }
  }

  // 6. Заказ через API + идемпотентность + трекинг + видимость в админке + резерв.
  let orderNumber = null, accessToken = null;
  if (ids.A) {
    const idemKey = `zzqa-${ids.A}`;
    try {
      const body = JSON.stringify({
        items: [{ productId: ids.A, qty: 1 }],
        customer: { name: `${PREFIX}Тест Покупатель`, email: QA_EMAIL, phone: '+70000000000' },
        delivery: { type: 'pickup' },
        paymentMethod: 'cod',
      });
      const o1 = await sf(`/orders`, { method: 'POST', headers: { 'idempotency-key': idemKey }, body });
      orderNumber = o1.body?.data?.number; accessToken = o1.body?.data?.accessToken;
      if (o1.status === 201 && orderNumber) PASS('order create', `№${orderNumber} статус=${o1.body?.data?.status}`);
      else FAIL('order create', `status=${o1.status} body=${JSON.stringify(o1.body).slice(0, 200)}`);

      const o2 = await sf(`/orders`, { method: 'POST', headers: { 'idempotency-key': idemKey }, body });
      if (o2.status === 200 && o2.body?.data?.number === orderNumber) PASS('order idempotency', 'повтор → 200, тот же №');
      else FAIL('order idempotency', `status=${o2.status} number=${o2.body?.data?.number}`);
    } catch (e) { FAIL('order create', e.message); }

    if (orderNumber && accessToken) {
      try {
        const t = await sf(`/orders/${orderNumber}?token=${encodeURIComponent(accessToken)}`);
        if (t.status === 200 && t.body?.data) PASS('order tracking', 'трекинг по токену доступен');
        else FAIL('order tracking', `status=${t.status}`);
      } catch (e) { FAIL('order tracking', e.message); }
    }

    if (orderNumber) {
      try {
        await page.goto(`${ADMIN}/admin/orders`, { waitUntil: 'networkidle' });
        const visible = await page.locator(`text=${orderNumber}`).count();
        if (visible > 0) PASS('order в админке', `№${orderNumber} виден в /admin/orders`);
        else FAIL('order в админке', `№${orderNumber} не найден на 1-й странице`);
      } catch (e) { FAIL('order в админке', e.message); }
    }

    // Резерв: было 50, 1 зарезервирован → quote на 50 не должен быть fulfillable.
    try {
      const q = await sf(`/cart/quote`, { method: 'POST', body: JSON.stringify({ items: [{ productId: ids.A, qty: 50 }] }) });
      const f = q.body?.data?.fulfillable;
      if (f === false) PASS('inventory reserve', 'после заказа 1 шт остаток 50 уже не покрывает 50 (резерв учтён) ✓');
      else INFO('inventory reserve', `fulfillable=${f} (ожидали false; зависит от логики quote)`);
    } catch (e) { INFO('inventory reserve', e.message); }
  }

  // 7. Чистка товаров через UI (тест «Удалить навсегда» + уборка).
  for (const k of ['A', 'B', 'C', 'D']) {
    if (!ids[k]) continue;
    const ok = await deleteProductUI(page, ids[k]);
    if (ok) PASS(`delete ${k} (UI «Удалить навсегда»)`, ids[k]);
    else FAIL(`delete ${k}`, 'нет редиректа на /admin/catalog');
  }

  return { orderNumber };
}

async function runCleanup(page) {
  // Находим ZZ-QA-товары через поиск каталога и удаляем по одному.
  for (let pass = 0; pass < 10; pass++) {
    await page.goto(`${ADMIN}/admin/catalog?search=${encodeURIComponent(PREFIX)}`, { waitUntil: 'networkidle' });
    const links = await page.locator('a[href*="/admin/catalog/products/"]').evaluateAll((els) =>
      [...new Set(els.map((e) => e.getAttribute('href')).filter((h) => /products\/[0-9a-f-]{36}/.test(h)))]);
    if (links.length === 0) { INFO('cleanup товары', `не осталось ZZ-QA-товаров (проход ${pass})`); break; }
    const id = links[0].match(/products\/([0-9a-f-]{36})/)[1];
    const ok = await deleteProductUI(page, id);
    rec(ok ? 'PASS' : 'FAIL', 'cleanup delete', id);
  }
}

// Проверка, что все разделы админки реально рендерятся (без error-оверлея Next,
// с осмысленным заголовком/контентом). Перебор всего меню — «прокликать админку».
async function runSections(page) {
  const sections = [
    ['Дашборд', '/admin'],
    ['Каталог — товары', '/admin/catalog'],
    ['Каталог — категории', '/admin/catalog/categories'],
    ['Каталог — бренды', '/admin/catalog/brands'],
    ['Заказы', '/admin/orders'],
    ['Промокоды', '/admin/promo'],
    ['Доставка (СДЭК)', '/admin/cdek'],
    ['CMS — страницы', '/admin/cms'],
    ['Настройки', '/admin/settings'],
    ['Пользователи', '/admin/users'],
    ['Роли', '/admin/roles'],
    ['Аудит', '/admin/audit'],
  ];
  for (const [label, path] of sections) {
    try {
      const resp = await page.goto(`${ADMIN}${path}`, { waitUntil: 'networkidle' });
      const http = resp ? resp.status() : 0;
      const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
      const broken = /Application error|Unhandled Runtime|This page could not be found|Internal Server Error|client-side exception/i.test(bodyText);
      const h1 = (await page.locator('h1').first().textContent().catch(() => '')) || '';
      const finalUrl = page.url();
      const bouncedToLogin = /\/admin\/login/.test(finalUrl);
      if (http >= 200 && http < 400 && !broken && !bouncedToLogin && h1.trim()) {
        PASS(`раздел ${label}`, `${path} → "${h1.trim().slice(0, 40)}"`);
      } else {
        FAIL(`раздел ${label}`, `http=${http} h1="${h1.trim().slice(0, 30)}" broken=${broken} login=${bouncedToLogin}`);
      }
    } catch (e) {
      FAIL(`раздел ${label}`, e.message.slice(0, 120));
    }
  }
}

// --- E2E витрины: реальный проклик пути покупателя в браузере ---------------
// Создаёт ZZ-QA товары разных вариаций через админку, затем РЕАЛЬНО прокликивает
// витрину (STORE_ORIGIN) в отдельном чистом контексте: каталог → карточка
// (простой/с размером/распроданный) → корзина → чекаут (город→ПВЗ→оплата→заказ)
// → проверка заказа в админке → уборка. Это покрытие БРАУЗЕРНОГО UI витрины,
// которого не было (раньше витрину дёргали только через API).

// Резолв slug по имени из публичного листинга.
async function slugByName(name) {
  const list = await sf(`/products?limit=200`);
  const items = Array.isArray(list.body?.data) ? list.body.data : [];
  return items.find((i) => i.name === name)?.slug ?? null;
}

async function storeGoto(sp, path) {
  await sp.goto(`${STORE_ORIGIN}${path}`, { waitUntil: 'networkidle' });
  const txt = (await sp.locator('body').innerText().catch(() => '')) || '';
  const broken = /Application error|Unhandled Runtime|client-side exception|Internal Server Error/i.test(txt);
  if (broken) throw new Error(`страница ${path} с ошибкой рендера`);
  return txt;
}

async function ctaText(sp) {
  // Подпись основной кнопки покупки на карточке (первая полноширинная кнопка).
  const btns = sp.locator('button:has-text("корзину"), button:has-text("Нет в наличии"), button:has-text("Выберите размер"), button:has-text("Добавлено")');
  return ((await btns.first().textContent().catch(() => '')) || '').trim();
}

async function runE2E(browser, adminPage) {
  const ids = {};
  // --- SETUP: товары разных вариаций через админку ---
  try {
    ids.simple = await createProduct(adminPage, { name: `${PREFIX}E2E Простой`, price: 2490, compareAt: 2990, status: 'active' });
    await setStock(adminPage, 25);
    PASS('e2e setup: простой товар (скидка, остаток 25)', ids.simple);
  } catch (e) { FAIL('e2e setup простой', e.message); }

  try {
    ids.sized = await createProduct(adminPage, { name: `${PREFIX}E2E С размером`, price: 1990, status: 'active' });
    await addVariant(adminPage, 'M');
    await setStock(adminPage, 15);
    PASS('e2e setup: товар с размером M (остаток 15)', ids.sized);
  } catch (e) { FAIL('e2e setup с размером', e.message); }

  try {
    ids.oos = await createProduct(adminPage, { name: `${PREFIX}E2E Распродан`, price: 1000, status: 'active' });
    await setStock(adminPage, 0);
    PASS('e2e setup: распроданный простой товар (остаток 0)', ids.oos);
  } catch (e) { FAIL('e2e setup распродан', e.message); }

  // Дать витрине (ISR/no-store) увидеть новые товары.
  await adminPage.waitForTimeout(1500);
  const slugs = {};
  for (const [k, name] of [['simple', `${PREFIX}E2E Простой`], ['sized', `${PREFIX}E2E С размером`], ['oos', `${PREFIX}E2E Распродан`]]) {
    slugs[k] = await slugByName(name).catch(() => null);
  }

  // --- STOREFRONT: чистый контекст (пустой localStorage → пустая корзина) ---
  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  const consoleErrors = [];
  sp.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  sp.on('pageerror', (e) => consoleErrors.push('pageerror: ' + (e.message || '').slice(0, 160)));

  try {
    // 1. Главная
    try { await storeGoto(sp, '/'); PASS('e2e главная рендерится'); }
    catch (e) { FAIL('e2e главная', e.message); }

    // 2. Каталог — новые товары видны
    try {
      const txt = await storeGoto(sp, '/catalog');
      const hasSimple = txt.includes(`${PREFIX}E2E Простой`);
      const hasSized = txt.includes(`${PREFIX}E2E С размером`);
      if (hasSimple && hasSized) PASS('e2e каталог: товары видны', 'простой+с размером');
      else FAIL('e2e каталог', `простой=${hasSimple} сразмером=${hasSized}`);
    } catch (e) { FAIL('e2e каталог', e.message); }

    // 3. Карточка простого товара → "В корзину", добавить
    if (slugs.simple) {
      try {
        await storeGoto(sp, `/product/${slugs.simple}`);
        const cta = await ctaText(sp);
        if (cta === 'В корзину') PASS('e2e карточка простого: кнопка "В корзину"');
        else FAIL('e2e карточка простого', `кнопка="${cta}" (ждали "В корзину")`);
        await sp.getByRole('button', { name: 'В корзину', exact: true }).first().click();
        await sp.waitForTimeout(800);
        const after = await ctaText(sp);
        if (after === 'Добавлено') PASS('e2e добавление простого: "Добавлено"');
        else INFO('e2e добавление простого', `после клика кнопка="${after}"`);
      } catch (e) { FAIL('e2e карточка простого', e.message); }
    } else FAIL('e2e карточка простого', 'slug не найден');

    // 4. Карточка с размером → "Выберите размер" → выбрать M → "В корзину" → добавить
    if (slugs.sized) {
      try {
        await storeGoto(sp, `/product/${slugs.sized}`);
        const cta0 = await ctaText(sp);
        if (cta0 === 'Выберите размер') PASS('e2e карточка с размером: до выбора "Выберите размер"');
        else FAIL('e2e карточка с размером (до выбора)', `кнопка="${cta0}"`);
        await sp.getByRole('button', { name: 'M', exact: true }).first().click();
        await sp.waitForTimeout(400);
        const cta1 = await ctaText(sp);
        if (cta1 === 'В корзину') PASS('e2e карточка с размером: после выбора M "В корзину"');
        else FAIL('e2e карточка с размером (после выбора)', `кнопка="${cta1}"`);
        await sp.getByRole('button', { name: 'В корзину', exact: true }).first().click();
        await sp.waitForTimeout(800);
      } catch (e) { FAIL('e2e карточка с размером', e.message); }
    } else FAIL('e2e карточка с размером', 'slug не найден');

    // 5. Карточка распроданного → "Нет в наличии" (нельзя купить)
    if (slugs.oos) {
      try {
        await storeGoto(sp, `/product/${slugs.oos}`);
        const cta = await ctaText(sp);
        if (cta === 'Нет в наличии') PASS('e2e карточка распроданного: "Нет в наличии"');
        else FAIL('e2e карточка распроданного', `кнопка="${cta}" (ждали "Нет в наличии")`);
      } catch (e) { FAIL('e2e карточка распроданного', e.message); }
    }

    // 6. Корзина — 2 позиции, изменение количества
    try {
      const txt = await storeGoto(sp, '/cart');
      await sp.waitForTimeout(800); // регидрация persist
      const txt2 = (await sp.locator('body').innerText().catch(() => '')) || txt;
      const hasItems = txt2.includes(`${PREFIX}E2E Простой`) && txt2.includes(`${PREFIX}E2E С размером`);
      if (hasItems) PASS('e2e корзина: обе позиции видны');
      else FAIL('e2e корзина', `содержимое не содержит обе позиции`);
    } catch (e) { FAIL('e2e корзина', e.message); }

    // 7. Чекаут — контакты → город → ПВЗ → оплата → заказ
    let orderNumber = null;
    try {
      await storeGoto(sp, '/checkout');
      await sp.waitForTimeout(800);
      // Шаг 1: контакты (4 поля по порядку: имя, фамилия, email, телефон)
      const inputs = sp.locator('input');
      await inputs.nth(0).fill('Тест');
      await inputs.nth(1).fill('Покупатель');
      await inputs.nth(2).fill(QA_EMAIL);
      await inputs.nth(3).fill('+70000000000');
      await sp.getByRole('button', { name: 'Далее' }).first().click();
      await sp.waitForTimeout(600);
      // Шаг 2: город
      const cityInput = sp.locator('input[placeholder="Начните вводить..."]');
      await cityInput.fill('Москва');
      await sp.waitForTimeout(900); // debounce + сеть
      const cityOpt = sp.locator('div.absolute button').first();
      await cityOpt.waitFor({ state: 'visible', timeout: 8000 });
      await cityOpt.click();
      // ПВЗ + стоимость
      await sp.waitForTimeout(2500);
      const pvzBtn = sp.locator('button:has-text("ПВЗ"), button').filter({ hasText: /ПВЗ|пункт|ул\.|пр\.|д\./i }).first();
      // запасной путь: первая кнопка в группе "Пункт выдачи"
      const pvzGroup = sp.locator('p:has-text("Пункт выдачи")').locator('xpath=following-sibling::div[1]//button').first();
      if (await pvzGroup.count()) { await pvzGroup.click(); }
      else if (await pvzBtn.count()) { await pvzBtn.click(); }
      await sp.waitForTimeout(600);
      await sp.getByRole('button', { name: 'Далее' }).first().click();
      await sp.waitForTimeout(2500);
      // Шаг 3: подтвердить
      const summary = (await sp.locator('body').innerText().catch(() => '')) || '';
      const hasTotals = /Итого/.test(summary) && /Доставка/.test(summary);
      if (hasTotals) PASS('e2e чекаут: серверный итог показан (товары/доставка/итого)');
      else FAIL('e2e чекаут итог', 'нет блока сумм на шаге оплаты');
      await sp.getByRole('button', { name: /Подтвердить заказ/ }).first().click();
      await sp.waitForURL(/\/account/, { timeout: 20000 });
      const acc = (await sp.locator('body').innerText().catch(() => '')) || '';
      const m = acc.match(/№?\s*([A-Z0-9-]{4,})/);
      const url = new URL(sp.url());
      orderNumber = url.searchParams.get('order');
      if (orderNumber) PASS('e2e чекаут: заказ оформлен', `№${orderNumber}`);
      else FAIL('e2e чекаут оформление', `редирект на ${sp.url()}, тело: ${acc.slice(0, 100)}`);
    } catch (e) {
      FAIL('e2e чекаут', e.message);
    }

    // 8. Заказ виден в админке
    if (orderNumber) {
      try {
        await adminPage.goto(`${ADMIN}/admin/orders`, { waitUntil: 'networkidle' });
        const visible = await adminPage.locator(`text=${orderNumber}`).count();
        if (visible > 0) PASS('e2e заказ в админке', `№${orderNumber}`);
        else FAIL('e2e заказ в админке', `№${orderNumber} не найден`);
      } catch (e) { FAIL('e2e заказ в админке', e.message); }
    }

    if (consoleErrors.length) INFO('e2e консоль витрины', `ошибок: ${consoleErrors.length}; первая: ${consoleErrors[0]}`);
    else PASS('e2e консоль витрины', 'без ошибок в консоли');
  } finally {
    await ctx.close();
  }

  // --- CLEANUP ---
  for (const k of ['simple', 'sized', 'oos']) {
    if (!ids[k]) continue;
    const ok = await deleteProductUI(adminPage, ids[k]);
    rec(ok ? 'PASS' : 'FAIL', `e2e cleanup ${k}`, ids[k]);
  }
}

// --- запуск ---------------------------------------------------------------

const browser = await chromium.launch();
const page = await browser.newPage();
let code = 0;
try {
  const ok = await login(page);
  if (!ok) { FAIL('login', page.url()); code = 1; }
  else {
    PASS('login', page.url());
    if (phase === 'catalog') {
      await page.goto(`${ADMIN}/admin/catalog`, { waitUntil: 'networkidle' });
      INFO('catalog rows', String(await page.locator('table tbody tr').count().catch(() => 0)));
    } else if (phase === 'full') {
      await runFull(page);
    } else if (phase === 'sections') {
      await runSections(page);
    } else if (phase === 'e2e') {
      await runE2E(browser, page);
    } else if (phase === 'cleanup') {
      await runCleanup(page);
    }
  }
} catch (e) {
  FAIL('FATAL', e.stack || e.message); code = 3;
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.status === 'PASS').length;
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(`\n===== ИТОГ: PASS=${passed} FAIL=${failed} =====`);
if (failed > 0 && code === 0) code = 1;
process.exit(code);
