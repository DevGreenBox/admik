// ============================================================================
// Глубокая живая проверка АДМИНКИ в разных состояниях (Playwright).
// Глубже фазы `sections` (та проверяет лишь рендер): открывает реальные формы,
// применяет фильтры, открывает существующий заказ/товар. READ-ONLY — НЕ сохраняет,
// НЕ создаёт, НЕ удаляет данные владельца.
//   export OWNER_EMAIL=...; export OWNER_PASSWORD=...
//   node scripts/live-admin-explore.mjs
// ============================================================================
import { chromium } from '@playwright/test';

const ADMIN = process.env.BASE || 'https://admin.erfgq.website';
const EMAIL = process.env.OWNER_EMAIL;
const PWD = process.env.OWNER_PASSWORD;
if (!EMAIL || !PWD) { console.error('NO_CREDS'); process.exit(2); }

const out = [];
const rec = (s, step, d = '') => { out.push({ s, step, d }); console.log(`[${s}] ${step}${d ? ` — ${d}` : ''}`); };
const PASS = (s, d) => rec('PASS', s, d);
const WARN = (s, d) => rec('WARN', s, d);
const FAIL = (s, d) => rec('FAIL', s, d);
const INFO = (s, d) => rec('INFO', s, d);

const BROKEN = /Application error|Unhandled Runtime|could not be found|Internal Server Error|client-side exception|TypeError|undefined is not/i;

async function login(page) {
  await page.goto(`${ADMIN}/admin/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PWD);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1200);
  return !/\/admin\/login/.test(page.url());
}

const main = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 160)));

  if (!(await login(page))) { FAIL('login', page.url()); await browser.close(); process.exit(1); }
  PASS('login', page.url());

  // --- 1. Дашборд: метрики/графики --------------------------------------
  try {
    await page.goto(`${ADMIN}/admin`, { waitUntil: 'networkidle' });
    const t = await page.locator('body').innerText();
    if (BROKEN.test(t)) FAIL('дашборд', 'битый контент');
    else {
      const hasMetrics = /заказ|выручк|посещен|товар|сегодн|период/i.test(t);
      PASS('дашборд', hasMetrics ? 'метрики/блоки видны' : 'рендерится');
      const svg = await page.locator('svg, canvas').count();
      INFO('дашборд: графических элементов (svg/canvas)', String(svg));
    }
  } catch (e) { FAIL('дашборд', e.message.slice(0, 120)); }

  // --- 2. Каталог: фильтры + открыть форму товара -----------------------
  try {
    await page.goto(`${ADMIN}/admin/catalog`, { waitUntil: 'networkidle' });
    const PROD_LINK = 'a[href*="/admin/catalog/products/"]:not([href$="/new"])';
    const rowsAll = await page.locator(PROD_LINK).count();
    INFO('каталог: ссылок на товары', String(rowsAll));
    // фильтр-поиск, если есть поле
    const search = page.locator('input[type="search"], input[name="q"], input[placeholder*="оиск"]').first();
    if (await search.count()) {
      await search.fill('халат');
      await page.waitForTimeout(1500);
      const txt = await page.locator('body').innerText();
      if (/халат/i.test(txt)) PASS('каталог: фильтр-поиск «халат» работает'); else WARN('каталог: фильтр-поиск', 'результат не распознан');
      await search.fill('');
      await page.waitForTimeout(800);
    } else INFO('каталог: поле поиска', 'не найдено');
    // открыть форму существующего товара
    await page.goto(`${ADMIN}/admin/catalog`, { waitUntil: 'networkidle' });
    const firstEdit = page.locator(PROD_LINK).first();
    if (await firstEdit.count()) {
      const href = await firstEdit.getAttribute('href');
      await page.goto(`${ADMIN}${href}`, { waitUntil: 'networkidle' });
      const ft = await page.locator('body').innerText();
      if (BROKEN.test(ft)) FAIL('форма товара', `битая: ${href}`);
      else {
        const tabs = /Основн|Вариант|Характеристик|Медиа|SEO|Цен|Остат/i.test(ft);
        const nameInput = await page.locator('input[name="name"], input#name').count();
        PASS('форма товара: открыта', `${href.slice(0, 40)} tabs=${tabs} nameInput=${nameInput > 0}`);
      }
    } else WARN('форма товара', 'нет товаров для открытия');
  } catch (e) { FAIL('каталог/форма товара', e.message.slice(0, 120)); }

  // --- 3. Заказы: открыть карточку существующего заказа -----------------
  try {
    await page.goto(`${ADMIN}/admin/orders`, { waitUntil: 'networkidle' });
    const orderLinks = page.locator('a[href*="/admin/orders/"]');
    const n = await orderLinks.count();
    INFO('заказы: ссылок', String(n));
    if (n > 0) {
      const href = await orderLinks.first().getAttribute('href');
      await page.goto(`${ADMIN}${href}`, { waitUntil: 'networkidle' });
      const ot = await page.locator('body').innerText();
      if (BROKEN.test(ot)) FAIL('карточка заказа', `битая: ${href}`);
      else {
        const hasStatus = /статус|оплат|доставк|истори|позици|итог/i.test(ot);
        const hasControls = await page.getByRole('button').count();
        PASS('карточка заказа: открыта', `статус-инфо=${hasStatus} кнопок=${hasControls}`);
      }
    } else INFO('карточка заказа', 'нет заказов');
  } catch (e) { FAIL('карточка заказа', e.message.slice(0, 120)); }

  // --- 4. Промокоды: форма создания (без сохранения) --------------------
  try {
    await page.goto(`${ADMIN}/admin/promo/new`, { waitUntil: 'networkidle' });
    const pt = await page.locator('body').innerText();
    if (BROKEN.test(pt)) FAIL('форма промокода', 'битая');
    else {
      const fields = await page.locator('input, select').count();
      const hasScope = /scope|механик|тип|процент|фикс|BOGO|N×M|подар/i.test(pt);
      PASS('форма промокода (new): открыта', `полей=${fields} mechanics=${hasScope}`);
    }
  } catch (e) { FAIL('форма промокода', e.message.slice(0, 120)); }

  // --- 5. CMS: список + редактор ----------------------------------------
  try {
    await page.goto(`${ADMIN}/admin/cms`, { waitUntil: 'networkidle' });
    const ct = await page.locator('body').innerText();
    if (BROKEN.test(ct)) FAIL('CMS список', 'битый');
    else {
      PASS('CMS: список открыт');
      // попробуем форму новой страницы
      await page.goto(`${ADMIN}/admin/cms/new`, { waitUntil: 'networkidle' }).catch(() => {});
      const nt = await page.locator('body').innerText().catch(() => '');
      if (nt && !BROKEN.test(nt)) PASS('CMS: форма новой страницы открыта');
      else INFO('CMS: форма новой страницы', 'маршрут /cms/new не открылся (возможно иной путь)');
    }
  } catch (e) { FAIL('CMS', e.message.slice(0, 120)); }

  // --- 6. Настройки: поля заполнены -------------------------------------
  try {
    await page.goto(`${ADMIN}/admin/settings`, { waitUntil: 'networkidle' });
    const st = await page.locator('body').innerText();
    if (BROKEN.test(st)) FAIL('настройки', 'битые');
    else {
      const inputs = await page.locator('input, select, textarea').count();
      const hasShopName = /THE CASE/i.test(st) || (await page.locator('input[value*="THE CASE" i]').count()) > 0;
      PASS('настройки: открыты', `полей=${inputs} shopName-видно=${hasShopName}`);
    }
  } catch (e) { FAIL('настройки', e.message.slice(0, 120)); }

  // --- 7. СДЭК / Пользователи / Роли / Аудит: контент --------------------
  for (const [label, path, expect] of [
    ['СДЭК', '/admin/cdek', /СДЭК|доставк|отправлен|ПВЗ|CDEK/i],
    ['Пользователи', '/admin/users', /польз|email|роль|owner|admin/i],
    ['Роли', '/admin/roles', /роль|право|permission|owner|admin|manager/i],
    ['Аудит', '/admin/audit', /аудит|событи|action|дата|user/i],
  ]) {
    try {
      await page.goto(`${ADMIN}${path}`, { waitUntil: 'networkidle' });
      const t = await page.locator('body').innerText();
      if (BROKEN.test(t)) FAIL(`раздел ${label}`, 'битый');
      else PASS(`раздел ${label}`, expect.test(t) ? 'осмысленный контент' : 'рендерится');
    } catch (e) { FAIL(`раздел ${label}`, e.message.slice(0, 120)); }
  }

  if (errors.length) WARN('console-ошибки админки', `${errors.length}: ` + errors.slice(0, 4).join(' | '));
  else PASS('console-ошибки админки', 'нет');

  await browser.close();
  const fails = out.filter((o) => o.s === 'FAIL');
  const warns = out.filter((o) => o.s === 'WARN');
  console.log(`\n===== ИТОГ ADMIN-EXPLORE: PASS=${out.filter((o) => o.s === 'PASS').length} WARN=${warns.length} FAIL=${fails.length} =====`);
  if (fails.length) { console.log('--- FAIL ---'); fails.forEach((f) => console.log(`  ✗ ${f.step}: ${f.d}`)); }
  if (warns.length) { console.log('--- WARN ---'); warns.forEach((w) => console.log(`  ⚠ ${w.step}: ${w.d}`)); }
  process.exit(fails.length ? 1 : 0);
};

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
