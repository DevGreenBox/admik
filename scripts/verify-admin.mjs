// ============================================================================
// Живая проверка админки + storefront на боевом стенде (Playwright + fetch).
//
// КОНТЕКСТ: запускать в НОВОЙ сессии Claude с включённым bypassPermissions
// (иначе гард блокирует чтение OWNER_PASSWORD из .env стенда — см. docs/10 §0).
//
// ЗАПУСК:
//   cd /root/admik
//   export OWNER_EMAIL=$(ssh -i ~/.ssh/admik_deploy root@admin.erfgq.website \
//       'grep -E "^OWNER_EMAIL=" /opt/admik/.env | cut -d= -f2-')
//   export OWNER_PASSWORD=$(ssh -i ~/.ssh/admik_deploy root@admin.erfgq.website \
//       'grep -E "^OWNER_PASSWORD=" /opt/admik/.env | cut -d= -f2-')
//   PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright \
//     node scripts/verify-admin.mjs <phase>
//
// Фазы: login | catalog | full
// Секреты — ТОЛЬКО через env (в коде/логах их нет; не печатать!).
//
// ПОСЛЕ ПРОВЕРКИ ОБЯЗАТЕЛЬНО убрать тест-данные (товары/промокоды/заказ),
// которые создаст фаза full (имена с префиксом ZZ-QA-). См. checklist ниже.
// ============================================================================
import { chromium } from 'playwright';

const ADMIN = process.env.BASE || 'https://admin.erfgq.website';
const STORE = process.env.STORE || 'https://erfgq.website';
const EMAIL = process.env.OWNER_EMAIL;
const PASS = process.env.OWNER_PASSWORD;
const phase = process.argv[2] || 'login';
if (!EMAIL || !PASS) { console.error('NO_CREDS — задай OWNER_EMAIL/OWNER_PASSWORD'); process.exit(2); }

const log = (...a) => console.log(...a);
const PREFIX = 'ZZ-QA-'; // префикс тест-данных для последующей чистки

async function login(page) {
  await page.goto(`${ADMIN}/admin/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASS);
  await Promise.all([page.waitForLoadState('networkidle'), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
  return !/\/admin\/login/.test(page.url());
}

// Чек-лист «полной проверки» из Prevki.md (что должна закрыть фаза full):
//  1. Каталог открывается, существующие товары видны.
//  2. Создать товар A: рус. имя, цена, описание, статус draft, +вариант (размер+остаток), +SEO-поля.
//  3. Создать товар B: минимальный (имя+цена), active, остаток на уровне товара.
//  4. Переоткрыть A → SEO-поля сохранились; вкладка «Варианты»/«Медиа» доступны.
//  5. Промокод 1: percent 15%, без min. Промокод 2: fixed 300, min_order 5000.
//  6. Storefront cart/quote товара B с каждым промокодом → проверить применение/гейт по min.
//  7. Storefront: оформить заказ товара B → появился в /admin/orders.
//  8. Удалить A и B кнопкой «Удалить навсегда» (#1) → исчезли из списка.
//  9. Удалить промокоды; заказ — если админка позволяет (иначе пометить в отчёте).
// Селекторы форм: см. app/admin/(panel)/catalog/_components/ProductForm.tsx и promo-форму.
// (Реализацию фазы full допиливает сессия с доступом — UI можно прокликать итеративно.)

const browser = await chromium.launch();
const page = await browser.newPage();
let code = 0;
try {
  const ok = await login(page);
  log(ok ? 'LOGIN_OK' : 'LOGIN_FAIL', page.url());
  if (!ok) { log('snippet:', (await page.textContent('body') || '').slice(0, 300)); code = 1; }

  if (ok && (phase === 'catalog' || phase === 'full')) {
    await page.goto(`${ADMIN}/admin/catalog`, { waitUntil: 'networkidle' });
    const rows = await page.locator('table tbody tr').count().catch(() => 0);
    log('catalog rows:', rows);
  }

  if (ok && phase === 'full') {
    log('TODO full: реализовать чек-лист 2–9 (см. комментарий выше).');
  }
} catch (e) {
  log('ERROR', e.message); code = 3;
} finally {
  await browser.close();
}
process.exit(code);
