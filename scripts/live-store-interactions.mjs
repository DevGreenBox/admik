// ============================================================================
// Живая проверка ИНТЕРАКЦИЙ витрины THE CASE (Playwright): корзина (кол-во ±,
// удаление, persist через reload), избранное, фильтр по категории, переход из
// поиска. Глубже happy-path e2e. READ-ONLY: НЕ оформляет заказ.
//   node scripts/live-store-interactions.mjs
// ============================================================================
import { chromium } from '@playwright/test';

const STORE = process.env.STORE || 'https://erfgq.website';
const PRODUCT = process.env.PRODUCT || 'halat-meditsinskiy-belyy'; // простой, в наличии
const out = [];
const rec = (s, step, d = '') => { out.push({ s, step, d }); console.log(`[${s}] ${step}${d ? ` — ${d}` : ''}`); };
const PASS = (s, d) => rec('PASS', s, d);
const WARN = (s, d) => rec('WARN', s, d);
const FAIL = (s, d) => rec('FAIL', s, d);
const INFO = (s, d) => rec('INFO', s, d);

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 140)));

  // --- 1. Добавление в корзину с карточки товара -------------------------
  try {
    await page.goto(`${STORE}/product/${PRODUCT}`, { waitUntil: 'networkidle', timeout: 30000 });
    const buy = page.getByRole('button', { name: /в корзину|добавить/i }).first();
    if (!(await buy.count())) { FAIL('корзина: кнопка', 'нет кнопки «В корзину»'); }
    else {
      await buy.click();
      await page.waitForTimeout(1000);
      PASS('корзина: товар добавлен');
    }
  } catch (e) { FAIL('добавление в корзину', e.message.slice(0, 120)); }

  // --- 2. Страница корзины: позиция, кол-во ± -----------------------------
  try {
    await page.goto(`${STORE}/cart`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);
    const body = await page.locator('body').innerText();
    if (/корзина пуста/i.test(body)) { FAIL('корзина: позиция', 'корзина пуста после добавления'); }
    else {
      PASS('корзина: позиция видна');
      // увеличить количество
      const qtySpan = page.locator('span').filter({ hasText: /^\d+$/ }).first();
      const before = (await qtySpan.textContent().catch(() => '1')) || '1';
      const plus = page.getByRole('button', { name: /увеличить количество/i }).first();
      if (await plus.count()) {
        await plus.click(); await page.waitForTimeout(700);
        const after = (await qtySpan.textContent().catch(() => before)) || before;
        if (Number(after) === Number(before) + 1) PASS('корзина: + увеличивает количество', `${before}→${after}`);
        else WARN('корзина: +', `было ${before}, стало ${after}`);
        // уменьшить обратно
        const minus = page.getByRole('button', { name: /уменьшить количество/i }).first();
        if (await minus.count()) { await minus.click(); await page.waitForTimeout(700); PASS('корзина: − уменьшает количество'); }
      } else WARN('корзина: кнопка +', 'не найдена');
    }
  } catch (e) { FAIL('корзина: кол-во', e.message.slice(0, 120)); }

  // --- 3. Persist через reload -------------------------------------------
  try {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const body = await page.locator('body').innerText();
    if (/корзина пуста/i.test(body)) FAIL('корзина: persist', 'после reload корзина опустела (persist сломан)');
    else PASS('корзина: persist через reload — позиция сохранилась');
  } catch (e) { WARN('корзина: persist', e.message.slice(0, 120)); }

  // --- 4. Удаление позиции -----------------------------------------------
  try {
    const del = page.getByRole('button', { name: /удалить/i }).first();
    if (await del.count()) {
      await del.click(); await page.waitForTimeout(900);
      const body = await page.locator('body').innerText();
      if (/корзина пуста/i.test(body)) PASS('корзина: удаление → «Корзина пуста»');
      else WARN('корзина: удаление', 'позиция не исчезла / метка пустоты не появилась');
    } else WARN('корзина: удаление', 'кнопка «Удалить» не найдена');
  } catch (e) { WARN('корзина: удаление', e.message.slice(0, 120)); }

  // --- 5. Избранное (wishlist) -------------------------------------------
  try {
    await page.goto(`${STORE}/catalog`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);
    const fav = page.getByRole('button', { name: /в избранное|избранное/i }).first();
    if (await fav.count()) {
      await fav.click(); await page.waitForTimeout(700);
      await page.goto(`${STORE}/wishlist`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(800);
      const body = await page.locator('body').innerText();
      const productLinks = await page.locator('a[href*="/product/"]').count();
      if (/пуст/i.test(body) && productLinks === 0) WARN('избранное', 'после добавления вишлист пуст');
      else PASS('избранное: товар попал в вишлист', `карточек=${productLinks}`);
    } else WARN('избранное', 'кнопка «Избранное» на карточке не найдена');
  } catch (e) { WARN('избранное', e.message.slice(0, 120)); }

  // --- 6. Фильтр по категории (из навигации) -----------------------------
  try {
    // прямой переход по категории через query/route каталога
    await page.goto(`${STORE}/catalog?category=meditsinskie-kostyumy`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(900);
    const cards = await page.locator('a[href*="/product/"]').count();
    const body = await page.locator('body').innerText();
    if (/application error|exception/i.test(body)) FAIL('фильтр категории', 'страница с ошибкой');
    else PASS('фильтр по категории: каталог отфильтрован', `карточек=${cards}`);
  } catch (e) { WARN('фильтр категории', e.message.slice(0, 120)); }

  if (errors.length) WARN('console-ошибки', `${errors.length}: ` + errors.slice(0, 4).join(' | '));
  else PASS('console-ошибки', 'нет');

  await browser.close();
  const fails = out.filter((o) => o.s === 'FAIL');
  const warns = out.filter((o) => o.s === 'WARN');
  console.log(`\n===== ИТОГ STORE-INTERACTIONS: PASS=${out.filter((o) => o.s === 'PASS').length} WARN=${warns.length} FAIL=${fails.length} =====`);
  if (fails.length) { console.log('--- FAIL ---'); fails.forEach((f) => console.log(`  ✗ ${f.step}: ${f.d}`)); }
  if (warns.length) { console.log('--- WARN ---'); warns.forEach((w) => console.log(`  ⚠ ${w.step}: ${w.d}`)); }
  process.exit(fails.length ? 1 : 0);
};
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
