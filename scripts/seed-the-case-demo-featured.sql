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
--   4) фото = обложка коллекции витрины, ЗАЛИТАЯ В MinIO (bucket admik-media,
--      ключи products/demo/*.webp). ВАЖНО: относительный путь /images/... НЕЛЬЗЯ —
--      он рендерится только на витрине (её public), а в АДМИНКЕ (другой домен) даёт
--      битую картинку (404). Поэтому url = публичный S3-URL (admin-домен/media/...),
--      который грузится И в админке (свой домен), И на витрине (хост в next/image
--      remotePatterns). ПРЕДУСЛОВИЕ — загрузить файлы в MinIO один раз:
--        # на стенде:
--        docker compose cp storefront:/app/public/images/categories/<f>.webp /tmp/m/<f>.webp  # x6
--        docker compose cp /tmp/m/. minio:/tmp/m/
--        docker compose exec -T minio sh -c 'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; \
--          for f in women-front women-side women-back men-front men-side men-back; do mc cp /tmp/m/$f.webp local/admik-media/products/demo/$f.webp; done'
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
DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE slug LIKE 'demo-%');
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

-- (4) фото обложки из MinIO (грузится и в админке, и на витрине; см. предусловие выше).
-- Базовый URL = S3_PUBLIC_URL инстанса (для стенда THE CASE — admin.erfgq.website/media/admik-media).
INSERT INTO product_media (product_id, storage_key, url, type, mime, is_primary, sort)
SELECT p.id, 'products/demo/'||m.img||'.webp',
       'https://admin.erfgq.website/media/admik-media/products/demo/'||m.img||'.webp',
       'image','image/webp', true, 0
FROM products p
JOIN (VALUES
  ('demo-zhenskiy-1','women-front'), ('demo-zhenskiy-2','women-side'), ('demo-zhenskiy-3','women-back'),
  ('demo-muzhskoy-1','men-front'),   ('demo-muzhskoy-2','men-side'),   ('demo-muzhskoy-3','men-back')
) AS m(slug,img) ON m.slug = p.slug;

-- (5) размеры S/M/L/XL (варианты): имя варианта = размер (адаптер витрины
-- variantSize: attributes.size → имя → sku). Даёт селектор размера + кнопку
-- «Таблица размеров» (B12) на странице товара.
INSERT INTO product_variants (product_id, sku, name, is_active, sort, attributes_cache)
SELECT p.id, upper(replace(p.slug,'demo-',''))||'-'||s.size, s.size, true, s.sort, '{}'::jsonb
FROM products p CROSS JOIN (VALUES ('S',1),('M',2),('L',3),('XL',4)) AS s(size,sort)
WHERE p.slug LIKE 'demo-%';

-- (6) остатки по вариантам (когда есть варианты — сток считается по ним, не по товару)
INSERT INTO inventory (product_id, variant_id, warehouse_code, quantity, reserved)
SELECT pv.product_id, pv.id, 'main', 10, 0 FROM product_variants pv
WHERE pv.product_id IN (SELECT id FROM products WHERE slug LIKE 'demo-%');

COMMIT;
