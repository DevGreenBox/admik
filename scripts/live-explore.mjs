// ============================================================================
// Исследовательский живой прогон витрины THE CASE на боевом стенде.
// Цель — найти РЕАЛЬНЫЕ проблемы, которые увидит обычный пользователь в разных
// состояниях (НЕ happy-path e2e). Read-only: НЕ оформляет заказ, НЕ создаёт данные.
//   node scripts/live-explore.mjs
// ============================================================================
import { chromium } from '@playwright/test';

const STORE = process.env.STORE || 'https://erfgq.website';
const out = [];
const rec = (s, step, d = '') => { out.push({ s, step, d }); console.log(`[${s}] ${step}${d ? ` — ${d}` : ''}`); };
const PASS = (s, d) => rec('PASS', s, d);
const WARN = (s, d) => rec('WARN', s, d);
const FAIL = (s, d) => rec('FAIL', s, d);
const INFO = (s, d) => rec('INFO', s, d);

function attachConsole(page, bag) {
  page.on('console', (m) => { if (m.type() === 'error') bag.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => bag.push('PAGEERROR: ' + String(e).slice(0, 200)));
  page.on('response', (r) => { const u = r.url(); const st = r.status(); if (st >= 500) bag.push(`HTTP ${st} ${u.slice(0, 120)}`); });
}

async function brokenImages(page) {
  return page.evaluate(() => {
    const imgs = Array.from(document.images);
    return imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc).map((i) => i.currentSrc).slice(0, 5);
  });
}

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  const errors = [];
  attachConsole(page, errors);

  // --- 1. Главная ---------------------------------------------------------
  try {
    const r = await page.goto(STORE + '/', { waitUntil: 'networkidle', timeout: 30000 });
    PASS('главная: HTTP', String(r.status()));
    const bodyText = await page.locator('body').innerText();
    // мусор в навигации/контенте
    if (/ZZ-?W13|ZZ-QA|zz-w13|ZZ-?Родитель/i.test(bodyText)) FAIL('главная: МУСОР в контенте', 'видна тест-сущность ZZ-* (категория/товар)');
    else PASS('главная: нет ZZ-мусора в контенте');
    if (/\bTest\b/.test(bodyText) || /\bаа\b/.test(bodyText) || /\bttt\b/.test(bodyText)) WARN('главная: подозрительные имена', 'видны Test/аа/ttt — проверить, не мусор ли');
    const bi = await brokenImages(page);
    if (bi.length) WARN('главная: битые картинки', bi.join(' | ')); else PASS('главная: картинки целы');
    await page.screenshot({ path: '/tmp/expl-home.png', fullPage: false });
  } catch (e) { FAIL('главная', String(e).slice(0, 150)); }

  // --- 2. Навигация по категориям (Header) --------------------------------
  try {
    // ссылки в шапке/меню
    const links = await page.locator('header a, nav a').allTextContents();
    const navTxt = links.map((t) => t.trim()).filter(Boolean);
    INFO('навигация: пункты', navTxt.slice(0, 20).join(' / '));
    if (navTxt.some((t) => /ZZ|Родитель/i.test(t))) FAIL('навигация: тест-категория в меню', 'ZZ-* категория видна покупателю');
    else PASS('навигация: тест-категорий в меню нет');
  } catch (e) { WARN('навигация', String(e).slice(0, 120)); }

  // --- 3. Каталог ---------------------------------------------------------
  try {
    const r = await page.goto(STORE + '/catalog', { waitUntil: 'networkidle', timeout: 30000 });
    PASS('каталог: HTTP', String(r.status()));
    const cards = await page.locator('a[href*="/product/"]').count();
    INFO('каталог: карточек товара', String(cards));
    const txt = await page.locator('body').innerText();
    if (/ZZ-?W13|ZZ-QA/i.test(txt)) FAIL('каталог: ZZ-мусор', 'тест-товар/категория видны в каталоге');
    else PASS('каталог: нет ZZ-мусора');
    const bi = await brokenImages(page);
    if (bi.length) WARN('каталог: битые картинки', bi.join(' | ')); else PASS('каталог: картинки целы');
    await page.screenshot({ path: '/tmp/expl-catalog.png', fullPage: false });
  } catch (e) { FAIL('каталог', String(e).slice(0, 150)); }

  // --- 4. Поиск (крайние состояния) ---------------------------------------
  for (const [label, q] of [['кириллица', 'халат'], ['нет-результата', 'zzzнетничего'], ['спецсимвол', "%_'"], ['пусто', '']]) {
    try {
      await page.goto(STORE + '/search?q=' + encodeURIComponent(q), { waitUntil: 'networkidle', timeout: 30000 });
      const txt = (await page.locator('body').innerText()).slice(0, 400);
      const hasError = /error|ошибка|exception|500|undefined/i.test(txt);
      if (hasError) FAIL(`поиск[${label}]`, 'страница показывает ошибку: ' + txt.replace(/\n/g, ' ').slice(0, 120));
      else PASS(`поиск[${label}]`, 'без ошибки');
    } catch (e) { WARN(`поиск[${label}]`, String(e).slice(0, 120)); }
  }

  // --- 5. Карточка товара (в наличии и распроданный) ----------------------
  try {
    // в наличии
    await page.goto(STORE + '/product/halat-meditsinskiy-belyy', { waitUntil: 'networkidle', timeout: 30000 });
    const t1 = await page.locator('body').innerText();
    PASS('карточка(в наличии): открыта', /Халат/i.test(t1) ? 'имя видно' : 'имя НЕ видно');
    const hasBuy = await page.getByRole('button', { name: /корзин|купить|добавить/i }).count();
    if (hasBuy) PASS('карточка(в наличии): кнопка покупки есть'); else WARN('карточка(в наличии): нет кнопки покупки');
    const bi1 = await brokenImages(page);
    if (bi1.length) WARN('карточка: битые картинки', bi1.join(' | ')); else PASS('карточка: картинки целы');
    // распроданный
    await page.goto(STORE + '/product/bryuki-meditsinskie-sinie', { waitUntil: 'networkidle', timeout: 30000 });
    const t2 = await page.locator('body').innerText();
    if (/нет в наличии|распродан|out of stock/i.test(t2)) PASS('карточка(распродан): метка «нет в наличии» есть');
    else WARN('карточка(распродан): нет явной метки об отсутствии');
  } catch (e) { FAIL('карточка товара', String(e).slice(0, 150)); }

  // --- 6. Несуществующий товар / 404 --------------------------------------
  try {
    const r = await page.goto(STORE + '/product/zzz-nesushestvuet-404', { waitUntil: 'networkidle', timeout: 30000 });
    const code = r.status();
    const txt = (await page.locator('body').innerText()).slice(0, 200);
    if (code === 404 || /не найден|404|not found/i.test(txt)) PASS('404 товара', `HTTP ${code}, осмысленная страница`);
    else WARN('404 товара', `HTTP ${code} — нет явной 404 для несуществующего товара`);
  } catch (e) { WARN('404 товара', String(e).slice(0, 120)); }

  // --- 7. Прочие страницы (care/returns/terms/privacy/reviews/wishlist) ---
  for (const p of ['/care', '/returns', '/terms', '/privacy', '/reviews', '/wishlist', '/cart', '/account']) {
    try {
      const r = await page.goto(STORE + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const code = r.status();
      const txt = (await page.locator('body').innerText()).slice(0, 300);
      if (code >= 500) FAIL(`страница ${p}`, `HTTP ${code}`);
      else if (/exception|cannot read|undefined is not|TypeError/i.test(txt)) FAIL(`страница ${p}`, 'видна JS-ошибка в контенте');
      else PASS(`страница ${p}`, `HTTP ${code}`);
    } catch (e) { WARN(`страница ${p}`, String(e).slice(0, 120)); }
  }

  // --- 8. Мобильный вьюпорт (375px) — главная и каталог -------------------
  try {
    const mctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, locale: 'ru-RU' });
    const mp = await mctx.newPage();
    const merr = [];
    attachConsole(mp, merr);
    await mp.goto(STORE + '/', { waitUntil: 'networkidle', timeout: 30000 });
    // горизонтальный скролл = поломка верстки
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 5) WARN('мобайл: горизонтальный скролл', `overflow=${overflow}px (возможна поломка верстки)`);
    else PASS('мобайл: нет горизонтального переполнения');
    await mp.goto(STORE + '/catalog', { waitUntil: 'networkidle', timeout: 30000 });
    const ov2 = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (ov2 > 5) WARN('мобайл каталог: горизонтальный скролл', `overflow=${ov2}px`); else PASS('мобайл каталог: ок');
    await mp.screenshot({ path: '/tmp/expl-mobile-home.png' });
    if (merr.length) WARN('мобайл: console-ошибки', merr.slice(0, 3).join(' | '));
    await mctx.close();
  } catch (e) { WARN('мобайл', String(e).slice(0, 120)); }

  // --- console errors итог ------------------------------------------------
  if (errors.length) WARN('console-ошибки (desktop)', `${errors.length}: ` + errors.slice(0, 5).join(' | '));
  else PASS('console-ошибки (desktop)', 'нет');

  await browser.close();

  const fails = out.filter((o) => o.s === 'FAIL');
  const warns = out.filter((o) => o.s === 'WARN');
  console.log(`\n===== ИТОГ EXPLORE: PASS=${out.filter((o) => o.s === 'PASS').length} WARN=${warns.length} FAIL=${fails.length} =====`);
  if (fails.length) { console.log('--- FAIL ---'); fails.forEach((f) => console.log(`  ✗ ${f.step}: ${f.d}`)); }
  if (warns.length) { console.log('--- WARN ---'); warns.forEach((w) => console.log(`  ⚠ ${w.step}: ${w.d}`)); }
};

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
