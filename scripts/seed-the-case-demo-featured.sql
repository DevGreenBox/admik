-- Демо-сид витрины THE CASE: 6 «featured»-товаров (3 женских + 3 мужских) для
-- блока «Коллекция» на главной (B5, правка Саши «Заведи по 3 тестовых товара
-- муж/жен с фото обложки коллекции»). Idempotent: можно перезапускать.
--
-- Что делает:
--   1) удаляет мусорные категории test-123/test-12333 (правка Саши #7);
--   2) создаёт 2 подкатегории «Женское»/«Мужское» под «Медицинские костюмы»
--      (slug zhenskie/muzhskie — пол выводится из slug адаптером витрины
--      resolveGender; заодно демонстрирует второй ряд подкатегорий на /catalog — B8);
--   3) создаёт 6 demo-товаров (status active, is_featured=true) с привязкой к полу;
--   4) фото = обложка коллекции витрины: product_media.url = относительный путь
--      /images/categories/*.webp (THE CASE/public) — repository отдаёт primaryMediaUrl
--      из колонки url напрямую, поэтому относительный путь рендерится из public витрины
--      (без загрузки в MinIO);
--   5) остатки 20 шт (в наличии).
--
-- Запуск на стенде:
--   docker compose exec -T postgres psql -U admik -d admik -v ON_ERROR_STOP=1 \
--     < scripts/seed-the-case-demo-featured.sql
--
-- Универсальность: парент-категория ищется по slug 'meditsinskie-kostyumy'
-- (не по жёсткому UUID). Для другого магазина поменяй slug парента и пути картинок.

BEGIN;

-- (1) чистка мусорных категорий
DELETE FROM product_categories WHERE category_id IN (SELECT id FROM categories WHERE slug IN ('test-123','test-12333'));
DELETE FROM categories WHERE slug IN ('test-123','test-12333');

-- (2) гендерные подкатегории под парентом (по slug, портативно)
INSERT INTO categories (parent_id, slug, name, is_active, sort)
SELECT p.id, v.slug, v.name, true, v.sort
FROM (VALUES ('zhenskie','Женское',10), ('muzhskie','Мужское',20)) AS v(slug,name,sort)
CROSS JOIN (SELECT id FROM categories WHERE slug='meditsinskie-kostyumy') p
ON CONFLICT (slug) DO NOTHING;

-- (3) idempotent снос прежних demo-*
DELETE FROM inventory WHERE product_id IN (SELECT id FROM products WHERE slug LIKE 'demo-%');
DELETE FROM product_media WHERE product_id IN (SELECT id FROM products WHERE slug LIKE 'demo-%');
DELETE FROM product_categories WHERE product_id IN (SELECT id FROM products WHERE slug LIKE 'demo-%');
DELETE FROM products WHERE slug LIKE 'demo-%';

-- 6 demo-товаров
INSERT INTO products (sku, slug, name, description, status, base_price, is_featured, is_new) VALUES
 ('DEMO-W1','demo-zhenskiy-1','Костюм медицинский «Аура» (женский)','Демонстрационный товар витрины.','active',2990,true,true),
 ('DEMO-W2','demo-zhenskiy-2','Блуза медицинская «Лайт» (женская)','Демонстрационный товар витрины.','active',1690,true,false),
 ('DEMO-W3','demo-zhenskiy-3','Халат медицинский «Классик» (женский)','Демонстрационный товар витрины.','active',2490,true,false),
 ('DEMO-M1','demo-muzhskoy-1','Костюм медицинский «Профи» (мужской)','Демонстрационный товар витрины.','active',3290,true,true),
 ('DEMO-M2','demo-muzhskoy-2','Блуза медицинская «Сити» (мужская)','Демонстрационный товар витрины.','active',1790,true,false),
 ('DEMO-M3','demo-muzhskoy-3','Халат медицинский «Доктор» (мужской)','Демонстрационный товар витрины.','active',2690,true,false);

-- (3) пол через категорию
INSERT INTO product_categories (product_id, category_id, is_primary)
SELECT p.id, c.id, true FROM products p
JOIN categories c ON c.slug = CASE WHEN p.slug LIKE 'demo-zhenskiy%' THEN 'zhenskie' ELSE 'muzhskie' END
WHERE p.slug LIKE 'demo-%';

-- (4) фото обложки (относит. путь → public витрины)
INSERT INTO product_media (product_id, storage_key, url, type, mime, is_primary, sort)
SELECT p.id, 'demo'||substr(p.slug,5)||'.webp', m.url, 'image','image/webp', true, 0
FROM products p
JOIN (VALUES
  ('demo-zhenskiy-1','/images/categories/women-front.webp'),
  ('demo-zhenskiy-2','/images/categories/women-side.webp'),
  ('demo-zhenskiy-3','/images/categories/women-back.webp'),
  ('demo-muzhskoy-1','/images/categories/men-front.webp'),
  ('demo-muzhskoy-2','/images/categories/men-side.webp'),
  ('demo-muzhskoy-3','/images/categories/men-back.webp')
) AS m(slug,url) ON m.slug = p.slug;

-- (5) остатки в наличии
INSERT INTO inventory (product_id, variant_id, warehouse_code, quantity, reserved)
SELECT p.id, NULL, 'main', 20, 0 FROM products p WHERE p.slug LIKE 'demo-%';

COMMIT;
