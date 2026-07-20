-- =============================================================================
-- db/seed/the-case-attributes.sql
-- -----------------------------------------------------------------------------
-- КОНТЕНТ КОНКРЕТНОГО МАГАЗИНА «THE CASE» — справочники характеристик (цвет, пол)
-- и их привязка к существующим товарам и вариантам.
--
-- ЗАЧЕМ ЭТОТ ФАЙЛ ВООБЩЕ ПОЯВИЛСЯ (обезвреживание мины в данных, 2026-07-20).
-- На боевой БД таблицы attributes / attribute_values / product_attributes были
-- ПУСТЫ, а products.attributes_cache содержал значения, вписанные напрямую JSONB:
--     {"color": "Белый",  "gender": "women"}   -- ordo-women-white
--     {"color": "Графит", "gender": "men"}     -- altera-men-graphite
-- При этом rebuildProductAttributesCache (lib/catalog/cache.ts, вызывается из
-- setProductAttributes) пересобирает кеш ИЗ строк EAV. Строк не было, поэтому
-- ЛЮБОЕ сохранение характеристик товара в админке обнулило бы attributes_cache,
-- а вместе с ним:
--   • цвет на карточке (product.color);
--   • ПОЛ товара, по которому выбирается размерная сетка (ключ настроек
--     size_charts) — товар потерял бы свою сетку и получил все вкладками.
-- Достаточно было открыть карточку в админке и нажать «Сохранить».
--
-- Файл заводит EAV-строки, ТОЧНО СООТВЕТСТВУЮЩИЕ текущему содержимому кеша,
-- поэтому пересборка воспроизводит те же значения, а не пустоту.
--
-- ВТОРАЯ ЗАДАЧА: привязать цвет к ВАРИАНТАМ (variant_id), чтобы свотч на карточке
-- работал селектором (спринт B), а не только подписью-фолбэком.
--
-- ЧЕГО ЗДЕСЬ НЕТ. Второй цвет каждой модели (ORDO бежевый, ALTERA белый) и
-- недостающие полы НЕ добавляются: на них нет фотографий. Добавить цветовой
-- вариант в опубликованный товар без снимка — значит показать покупателю чужое
-- фото при выборе цвета. Заготовка — db/seed/the-case-catalog-full.sql.
--
-- НАКАТ:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seed/the-case-attributes.sql
-- ⚠️ После наката нужен рестарт app-контейнера: прямой SQL не инвалидирует
--    memo-кэш эффективных настроек и не пересобирает кеши через Server Action.
--
-- ИДЕМПОТЕНТНОСТЬ: все вставки через ON CONFLICT DO NOTHING / NOT EXISTS,
-- повторный накат ничего не дублирует и не перезаписывает правки владельца.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Справочники характеристик.
--    «Цвет» — ВАРИАНТНЫЙ (is_variant): участвует в образовании вариантов,
--    именно по нему админка строит матрицу цвет × размер.
--    «Пол» — обычный атрибут товара: витрина сужает его до women/men/unisex
--    (resolveGender в THE CASE/src/lib/admik/adapter.ts) и по нему подбирает
--    размерную сетку.
-- -----------------------------------------------------------------------------
INSERT INTO attributes (code, name, type, is_variant, is_filterable, sort)
VALUES
  ('color',  'Цвет', 'select', true,  true, 10),
  ('gender', 'Пол',  'select', false, true, 20)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Значения справочников.
--    HEX берётся из color_hex (миграция 0036) — палитра задаётся здесь, а не
--    хардкодом в коде витрины. Названия цветов — из каталога владельца
--    (docs/madina-brief-assets/katalog.pdf): белый \ white, бежевый \ dune,
--    графит \ graphite.
--    «Бежевый» заводится заранее: значение справочника безвредно и пригодится,
--    когда придут фотографии (см. заготовку полного каталога).
-- -----------------------------------------------------------------------------
INSERT INTO attribute_values (attribute_id, value, slug, sort, color_hex)
SELECT a.id, v.value, v.slug, v.sort, v.hex
FROM attributes a
JOIN (VALUES
  ('Белый',   'white',    10, '#FFFFFF'),
  ('Бежевый', 'dune',     20, '#D8C9AE'),
  ('Графит',  'graphite', 30, '#4A4A4F')
) AS v(value, slug, sort, hex) ON true
WHERE a.code = 'color'
ON CONFLICT (attribute_id, value) DO NOTHING;

INSERT INTO attribute_values (attribute_id, value, slug, sort)
SELECT a.id, v.value, v.slug, v.sort
FROM attributes a
JOIN (VALUES
  ('women', 'women', 10),
  ('men',   'men',   20)
) AS v(value, slug, sort) ON true
WHERE a.code = 'gender'
ON CONFLICT (attribute_id, value) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Привязки УРОВНЯ ТОВАРА (variant_id IS NULL).
--    Значения берутся ИЗ ТЕКУЩЕГО attributes_cache каждого товара, а не
--    прописываются списком: так строки EAV гарантированно совпадут с тем, что
--    сейчас видит покупатель, и пересборка кеша ничего не изменит.
--    Работает для ЛЮБОГО товара магазина, у которого в кеше есть color/gender,
--    а не только для ORDO и ALTERA.
-- -----------------------------------------------------------------------------
INSERT INTO product_attributes (product_id, variant_id, attribute_id, value_id)
SELECT p.id, NULL, a.id, av.id
FROM products p
JOIN attributes a       ON a.code = 'color'
JOIN attribute_values av ON av.attribute_id = a.id
                        AND av.value = p.attributes_cache ->> 'color'
WHERE p.attributes_cache ? 'color'
ON CONFLICT DO NOTHING;

INSERT INTO product_attributes (product_id, variant_id, attribute_id, value_id)
SELECT p.id, NULL, a.id, av.id
FROM products p
JOIN attributes a       ON a.code = 'gender'
JOIN attribute_values av ON av.attribute_id = a.id
                        AND av.value = p.attributes_cache ->> 'gender'
WHERE p.attributes_cache ? 'gender'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Привязки УРОВНЯ ВАРИАНТА: цвет товара проставляется каждому его варианту.
--    Сейчас у каждого товара один цвет, поэтому все варианты получают его же —
--    это и превращает подпись-фолбэк на карточке в настоящий селектор.
--    Имя варианта при этом ОСТАЁТСЯ меткой размера («42 / XS»): цвет в имя не
--    подмешиваем, иначе ломается фасет размеров каталога (array_agg по имени).
-- -----------------------------------------------------------------------------
INSERT INTO product_attributes (product_id, variant_id, attribute_id, value_id)
SELECT v.product_id, v.id, a.id, av.id
FROM product_variants v
JOIN products p         ON p.id = v.product_id
JOIN attributes a       ON a.code = 'color'
JOIN attribute_values av ON av.attribute_id = a.id
                        AND av.value = p.attributes_cache ->> 'color'
WHERE p.attributes_cache ? 'color'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Пересборка кешей ИЗ EAV — та же логика, что в lib/catalog/cache.ts.
--    Прямой SQL не может позвать Server Action, поэтому повторяем её здесь.
--    Проверка на месте: после этого шага attributes_cache товаров обязан
--    остаться прежним (color + gender), а у вариантов — получить color.
-- -----------------------------------------------------------------------------
UPDATE products p
SET attributes_cache = COALESCE(agg.cache, '{}'::jsonb)
FROM (
  SELECT pa.product_id,
         jsonb_object_agg(a.code, COALESCE(av.value, pa.value_text)) AS cache
  FROM product_attributes pa
  JOIN attributes a        ON a.id = pa.attribute_id
  LEFT JOIN attribute_values av ON av.id = pa.value_id
  WHERE pa.variant_id IS NULL
  GROUP BY pa.product_id
) agg
WHERE agg.product_id = p.id;

UPDATE product_variants v
SET attributes_cache = COALESCE(agg.cache, '{}'::jsonb)
FROM (
  SELECT pa.variant_id,
         jsonb_object_agg(a.code, COALESCE(av.value, pa.value_text)) AS cache
  FROM product_attributes pa
  JOIN attributes a        ON a.id = pa.attribute_id
  LEFT JOIN attribute_values av ON av.id = pa.value_id
  WHERE pa.variant_id IS NOT NULL
  GROUP BY pa.variant_id
) agg
WHERE agg.variant_id = v.id;

COMMIT;
