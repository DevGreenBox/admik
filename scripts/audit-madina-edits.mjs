// Целевой аудит витрины THE CASE против брифа Мадины/Ани (docs/madina-brief-assets).
// По каждому пункту правок печатает СТАТУС: DONE / TODO / CHECK (нужен глаз).
//   STORE=https://erfgq.website node scripts/audit-madina-edits.mjs
import { chromium } from 'playwright';

const STORE = process.env.STORE || 'https://erfgq.website';
const results = [];
const rec = (id, status, note) => { results.push({ id, status, note }); console.log(`[${status}] ${id} — ${note}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const txt = async (sel) => { try { return (await page.locator(sel).first().innerText()).trim(); } catch { return ''; } };
const bodyText = async () => { try { return await page.locator('body').innerText(); } catch { return ''; } };
const has = (hay, re) => re.test(hay);

// ===== ГЛАВНАЯ =====
await page.goto(STORE + '/', { waitUntil: 'networkidle', timeout: 30000 });
const home = await bodyText();

rec('М1 полоска форма/функция/дисциплина убрана',
  has(home, /форма\s*[/|]\s*функция|функция\s*[/|]\s*дисциплина/i) ? 'TODO' : 'DONE',
  'ищем строку-полоску «форма/функция/дисциплина»');

rec('М3 кнопка «Смотреть коллекцию» на обложке',
  has(home, /смотреть коллекцию/i) ? 'DONE' : 'TODO', 'кнопка на hero');

rec('М4 вкладка MEDICAL FASHION убрана',
  has(home, /medical fashion/i) ? 'TODO' : 'DONE', 'пункт меню/блок');

rec('М8 Editorial убран',
  has(home, /editorial/i) ? 'TODO' : 'DONE', 'блок Editorial');

rec('М9 Bestsellers скрыт',
  has(home, /bestseller|бестселлер/i) ? 'TODO' : 'DONE', 'блок Bestsellers');

rec('М10 слоган COMFORT+MEDICINE=THE CASE',
  has(home, /comfort.{0,4}medicine.{0,4}the case/i) ? 'DONE'
    : (has(home, /fashion meets medicine/i) ? 'TODO' : 'CHECK'),
  'заменить «FASHION MEETS MEDICINE»');

rec('А4/М6 вкладки Коллекция «Для женщин/мужчин»',
  has(home, /для женщин/i) && has(home, /для мужчин/i) ? 'DONE' : 'CHECK',
  'табы пола в блоке Коллекция');

rec('А1 первый блок кликабелен → каталог', 'CHECK', 'проверяется кликом (ниже)');

rec('А5 Categories→Категории',
  has(home, /categories/i) ? 'TODO' : (has(home, /категории/i) ? 'DONE' : 'CHECK'), 'подпись раздела');

rec('А8 Service убран из Доставки',
  has(home, /\bservice\b/i) ? 'TODO' : 'DONE', 'слово Service');

rec('А4b слово Shop убрано из Коллекции',
  has(home, /\bshop\b/i) ? 'TODO' : 'DONE', 'слово Shop');

rec('М12/А2в5 блок отзывов «ВЫ + THE CASE»',
  has(home, /вы\s*[+]\s*the case|отзыв/i) ? 'DONE' : 'TODO', 'секция фото-отзывов на главной');

rec('А2в14 блок «Качество ткани»',
  has(home, /качество ткани/i) ? 'CHECK' : 'TODO', 'есть блок — проверить оформление карточками');

// клик по первому блоку
try {
  await page.goto(STORE + '/', { waitUntil: 'networkidle' });
  const hero = page.locator('a').filter({ hasText: /смотреть коллекцию|the case/i }).first();
  const heroHref = await hero.getAttribute('href').catch(() => null);
  rec('А1 hero ведёт в каталог', heroHref && /catalog/.test(heroHref) ? 'DONE' : 'CHECK', `href=${heroHref}`);
} catch {}

// ===== НАВИГАЦИЯ / ДУБЛИ =====
const navLinks = await page.locator('header a, nav a').evaluateAll(els =>
  els.map(e => ({ t: (e.textContent || '').trim(), href: e.getAttribute('href') })).filter(x => x.t));
const navText = navLinks.map(l => l.t.toLowerCase());
const catalogDup = navText.filter(t => /каталог|коллекция/.test(t)).length;
rec('А2в3 Каталог/Коллекция не дублируются', catalogDup > 1 ? 'TODO' : 'DONE', `в шапке пунктов каталог/коллекция: ${catalogDup}`);
const deliveryDup = navText.filter(t => /доставка/.test(t)).length;
rec('А2в13 «Доставка и оплата» не дублируется в шапке', deliveryDup > 1 ? 'TODO' : 'DONE', `пунктов доставки: ${deliveryDup}`);

// ===== СТРАНИЦЫ =====
const pages = {
  'М14 обмен и возврат (/returns)': '/returns',
  'М14 оплата (/payment или /delivery)': '/payment',
  'М14 обработка ПДн (/privacy)': '/privacy',
  'М14 уход (/care)': '/care',
  'А10 Контакты отдельная страница (/contacts)': '/contacts',
  'М12/А12 пользовательское соглашение (/terms)': '/terms',
};
for (const [id, path] of Object.entries(pages)) {
  const r = await ctx.request.get(STORE + path, { maxRedirects: 3 }).catch(() => null);
  rec(id, r && r.status() < 400 ? 'DONE' : 'TODO', `${path} → HTTP ${r ? r.status() : 'ERR'}`);
}

// Контакты: телефон и форма
await page.goto(STORE + '/contacts', { waitUntil: 'networkidle' }).catch(() => {});
const contacts = await bodyText();
rec('А2в4 телефон +7 (982) 510-31-76', has(contacts, /982\D*510\D*31\D*76/) ? 'DONE' : 'TODO', 'в Контактах');
rec('А10 форма обратной связи на Контактах', (await page.locator('form').count()) > 0 ? 'DONE' : 'TODO', 'наличие <form>');
rec('М13 связь с поддержкой (тг/звонок)', has(contacts, /telegram|телеграм|t\.me|tel:/i) ? 'DONE' : 'CHECK', 'ссылки тг/тел');

// ===== ЛИЧНЫЙ КАБИНЕТ =====
const acc = await ctx.request.get(STORE + '/account', { maxRedirects: 0 }).catch(() => null);
rec('А11 иконка человека → личный кабинет', acc ? 'CHECK' : 'CHECK', `/account → HTTP ${acc ? acc.status() : 'ERR'} (проверить редирект на ЛК, не «Мои заказы»)`);

// ===== КАТАЛОГ =====
await page.goto(STORE + '/catalog', { waitUntil: 'networkidle' });
const catBody = await bodyText();
const productLinks = await page.locator('a[href^="/product/"]').evaluateAll(els => [...new Set(els.map(e => e.getAttribute('href')))]);
rec('А1/А9 товары ORDO/ALTERA залиты', has(catBody, /ordo/i) && has(catBody, /altera/i) ? 'DONE' : 'TODO',
  `в каталоге товаров: ${productLinks.length}; ORDO=${has(catBody,/ordo/i)} ALTERA=${has(catBody,/altera/i)}`);
rec('А1 лишние демо-товары убраны', productLinks.some(h => /demo-/.test(h)) ? 'TODO' : 'DONE',
  `demo-товары: ${productLinks.filter(h => /demo-/.test(h)).length}`);

// ===== КАРТОЧКА ТОВАРА =====
const firstProduct = productLinks[0];
if (firstProduct) {
  await page.goto(STORE + firstProduct, { waitUntil: 'networkidle' });
  const pdp = await bodyText();
  rec('М15 выбор цвета на карточке', has(pdp, /цвет|color/i) ? 'CHECK' : 'TODO', `товар ${firstProduct}`);
  rec('М15 «состав и уход» на карточке', has(pdp, /состав|уход/i) ? 'DONE' : 'TODO', 'блок состав/уход');
  // таблица размеров: кнопка + видимость
  const sizeBtn = page.locator('button, a').filter({ hasText: /таблица размеров|размерная сетка/i }).first();
  if (await sizeBtn.count()) {
    const beforeH = await page.evaluate(() => document.body.scrollHeight);
    await sizeBtn.click().catch(() => {});
    await page.waitForTimeout(600);
    const tableVisible = await page.locator('table, [role="dialog"]').filter({ hasText: /обхват|размер|S|M|L/i }).first().isVisible().catch(() => false);
    rec('М16 таблица размеров видна после клика', tableVisible ? 'DONE' : 'TODO', 'раскрытие таблицы');
  } else {
    rec('М16 таблица размеров', 'CHECK', 'кнопка таблицы не найдена на этом товаре');
  }
  // размер главного фото
  const heroImg = page.locator('img').first();
  const box = await heroImg.boundingBox().catch(() => null);
  rec('М15/А7 главное фото помещается в экран', box && box.height <= 900 ? 'DONE' : 'CHECK', `высота гл.фото ~${box ? Math.round(box.height) : '?'}px (viewport 900)`);
}

// ===== ОФОРМЛЕНИЕ ЗАКАЗА =====
await page.goto(STORE + '/checkout', { waitUntil: 'networkidle' }).catch(() => {});
const checkoutBody = await bodyText();
rec('А2в8 маска телефона в чекауте', 'CHECK', 'проверяется вводом (нужен товар в корзине)');
rec('А2в7 кнопка «Далее» с подсветкой ошибок', has(checkoutBody, /далее|продолжить|оформить/i) ? 'CHECK' : 'CHECK', 'проверяется кликом с пустыми полями');

// ===== FAQ / О КОМПАНИИ (тексты) =====
await page.goto(STORE + '/faq', { waitUntil: 'networkidle' }).catch(() => {});
const faq = await bodyText();
rec('А2в11 уход в FAQ: стирка 30°', has(faq, /30\s*°|30\s*градус/i) ? 'DONE' : (has(faq, /уход/i) ? 'TODO' : 'CHECK'), 'температура стирки');
await page.goto(STORE + '/about', { waitUntil: 'networkidle' }).catch(() => {});
const about = await bodyText();
const h1count = await page.locator('h1').count();
rec('А2в12 О компании: заголовки не задублированы', h1count > 1 ? 'TODO' : 'DONE', `h1 на странице: ${h1count}`);

// ===== ДОБИВКА 🔍-ПУНКТОВ =====
console.log('\n--- прицельные проверки ---');
// А1 hero-клик
try {
  await page.goto(STORE + '/', { waitUntil: 'networkidle' });
  const before = page.url();
  const heroBtn = page.locator('a,button').filter({ hasText: /смотреть коллекцию/i }).first();
  if (await heroBtn.count()) {
    await heroBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
    rec('А1 «Смотреть коллекцию» ведёт в каталог', /catalog/.test(page.url()) ? 'DONE' : 'TODO', `после клика: ${page.url()}`);
  }
} catch {}
// А11 /account содержимое — ЛК или Мои заказы?
try {
  await page.goto(STORE + '/account', { waitUntil: 'networkidle' });
  const a = await bodyText();
  const isOrdersOnly = /мои заказы/i.test(a) && !/профиль|личный кабинет|данные|настройки аккаунт/i.test(a);
  rec('А11 личный кабинет (не только «Мои заказы»)', isOrdersOnly ? 'TODO' : 'CHECK', `на /account: ${a.slice(0,80).replace(/\n/g,' ')}`);
} catch {}
// А2в7/8 чекаут: пустой submit + маска телефона (без товара — проверим наличие валидации/маски в форме)
try {
  await page.goto(STORE + '/checkout', { waitUntil: 'networkidle' });
  const phone = page.locator('input[type="tel"], input[name*="phone" i], input[placeholder*="телефон" i]').first();
  if (await phone.count()) {
    await phone.fill('999999999999999').catch(() => {});
    const val = await phone.inputValue().catch(() => '');
    const digits = (val.match(/\d/g) || []).length;
    rec('А2в8 маска телефона (≤11 цифр)', digits <= 11 && digits > 0 ? 'DONE' : 'TODO', `введено 15 девяток → осталось ${digits} цифр (${val})`);
  } else {
    rec('А2в8 маска телефона', 'CHECK', 'поле телефона на /checkout не найдено (возможно нужен товар в корзине)');
  }
  const nextBtn = page.locator('button').filter({ hasText: /далее|продолжить|оформить/i }).first();
  if (await nextBtn.count()) {
    await nextBtn.click().catch(() => {});
    await page.waitForTimeout(800);
    const errs = await page.locator('[class*="error" i], [aria-invalid="true"], .text-red-500, [role="alert"]').count();
    rec('А2в7 «Далее»: подсветка незаполненных полей', errs > 0 ? 'DONE' : 'TODO', `видимых индикаторов ошибок: ${errs}`);
  }
} catch (e) { rec('А2в7/8 чекаут', 'CHECK', 'ошибка проверки: ' + e.message.slice(0,60)); }

await browser.close();
console.log('\n=== СВОДКА ===');
const by = {};
results.forEach(r => by[r.status] = (by[r.status] || 0) + 1);
console.log(JSON.stringify(by));
console.log(`DONE=${by.DONE||0} TODO=${by.TODO||0} CHECK=${by.CHECK||0} из ${results.length}`);
