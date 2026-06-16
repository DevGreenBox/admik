# Деплой THE CASE на Netlify

Витрина THE CASE — **headless-потребитель Admik Storefront API**
(`/api/storefront/v1/*`). Своей БД, заказов, СДЭК и почты у неё нет: каталог,
цены, наличие, расчёт корзины, доставка и создание заказа — всё на стороне
Admik (см. `docs/13-сращивание-the-case.md`). Витрина только рендерит каталог и
хранит клиентское UX-состояние (корзина/вишлист в zustand → localStorage).

## Чеклист перед деплоем

- [ ] Код в Git (GitHub / GitLab / Bitbucket)
- [ ] В репозитории есть `public/images/` (~160 webp) **или** папка `Фото/` для сборки на Netlify
- [ ] Бэкенд Admik развёрнут и доступен по HTTPS
- [ ] Домен витрины добавлен в Admik (`STOREFRONT_ALLOWED_ORIGINS`) и/или выдан ключ (`STOREFRONT_API_KEYS`)
- [ ] Env-переменные заданы в Netlify **до** первого деплоя

---

## 1. Репозиторий

```bash
git init
git add .
git commit -m "Prepare THE CASE for Netlify"
git remote add origin <url-репозитория>
git push -u origin main
```

**Не коммитьте:** `.env`, `node_modules`, `.next`

**Обязательно в репозитории:** `public/images/`, `netlify.toml`

---

## 2. Netlify — переменные окружения

**Site configuration → Environment variables → Production**

| Переменная | Обязательно | Пример |
|------------|-------------|--------|
| `ADMIK_API_URL` | да | `https://admik.example.com` (server-side) |
| `NEXT_PUBLIC_ADMIK_API_URL` | да | `https://admik.example.com` (клиент: checkout, автокомплит) |
| `STOREFRONT_API_KEY` | если Admik на ключах | выдаётся в Admik (`STOREFRONT_API_KEYS`) |
| `NEXT_PUBLIC_SITE_URL` | да | `https://your-site.netlify.app` |

Если Admik настроен на Origin-allowlist (`STOREFRONT_ALLOWED_ORIGINS`), ключ
можно не задавать. В dev/mock-режиме Admik доступ открыт без ключей.

---

## 3. Netlify — подключение сайта

1. [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**
2. Подключите Git-репозиторий
3. Настройки из `netlify.toml` (приоритет над UI):
   - **Build command:** `npm run build:netlify`
   - **Publish directory:** `.next` (задаётся в `netlify.toml`)
   - **Plugin:** `@netlify/plugin-nextjs`
   - **Node:** 22
4. **Критично — очистите Publish directory в UI:**
   - Site settings → Build & deploy → Build settings → **Publish directory**
   - Удалите `/` или `.` если там указан корень репозитория
   - Ошибка «publish directory cannot be the same as the base directory» = в UI стоит корень репо
5. Добавьте env-переменные (шаг 2)
6. **Deploy site** → лучше **Clear cache and deploy site**

---

## 4. Свой домен

**Domain management → Add custom domain** → обновите `NEXT_PUBLIC_SITE_URL` на
финальный URL и добавьте этот домен в `STOREFRONT_ALLOWED_ORIGINS` на стороне Admik.

---

## Что делает `npm run build:netlify`

1. `npm run foto` — только локально, если нет `public/images/` и есть папка `Фото/` (на Netlify пропускается)
2. `next build`

БД/Prisma/миграций/сидов нет — каталог приходит из Admik по HTTP во время
рендера/запроса.

---

## Локальная разработка

```bash
cp .env.example .env
# Укажите ADMIK_API_URL / NEXT_PUBLIC_ADMIK_API_URL на адрес локального/тестового Admik
npm install
npm run dev
```

---

## Частые проблемы

| Проблема | Решение |
|----------|---------|
| Пустой каталог / ошибки загрузки | Проверьте `ADMIK_API_URL` и доступность Admik по HTTPS |
| 401/403 от Storefront API | Домен витрины не в `STOREFRONT_ALLOWED_ORIGINS` или неверный `STOREFRONT_API_KEY` |
| Checkout/автокомплит не работает | Проверьте `NEXT_PUBLIC_ADMIK_API_URL` (клиентский, должен быть публичным) |
| Нет картинок секций | Закоммитьте `public/images/` или добавьте `Фото/` |
| Publish directory = repo root | UI → очистите Publish directory; в `netlify.toml` уже `publish = ".next"` |
| `.netlify/output` not found | Не используйте `.netlify/output` — для plugin v5 нужен `.next` |
| Домен thecase.ru | Это **другой** сайт — используйте ваш `*.netlify.app` или свой домен |

---

## СДЭК и оплата

СДЭК (поиск городов, ПВЗ, расчёт) и оплата проксируются через Admik Storefront
API (`/delivery/cdek/*`, `/cart/quote`, `/orders`). Ключи СДЭК/эквайринга у
витрины не хранятся — они на стороне Admik. В dev/mock Admik отдаёт фикстуры.
