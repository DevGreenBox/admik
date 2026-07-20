-- =============================================================================
-- 0036_attribute_values_color_hex.sql  (спринт B — цвет как вариант)
--
-- attribute_values.color_hex — опциональный HEX-код значения справочника «Цвет»
-- (docs/05 §2.4, ADR-007). Нужен витрине, чтобы рисовать интерактивный свотч
-- цвета варианта, а не подписывать его текстом.
--
-- ПОЧЕМУ ЗДЕСЬ, А НЕ В attributes_cache: products.attributes_cache имеет форму
-- Record<string, string | string[]> (buildAttributesCache кладёт COALESCE(av.value,
-- pa.value_text) — только строку значения). Класть в него объект {value,hex}
-- сломало бы публичный контракт кеша, поэтому hex живёт в словаре значений, а
-- DTO подтягивает его отдельным джойном к attribute_values.
--
-- Формат: '#RRGGBB' (регистр любой). NULL = hex не задан (значение отрисуется
-- текстом) — колонка nullable, старые строки валидны без изменений, старый код
-- о колонке не знает и продолжает работать (аддитивность, §6.4/ADR-015).
--
-- Идемпотентно: ADD COLUMN IF NOT EXISTS; CHECK — через DO-блок + pg_constraint
-- (ALTER ... ADD CONSTRAINT не поддерживает IF NOT EXISTS — образец 0019);
-- запись в schema_migrations ON CONFLICT DO NOTHING.
--
-- GRANT не нужен: права выданы на таблицу attribute_values целиком (0008) и
-- автоматически распространяются на новую колонку.
-- =============================================================================

ALTER TABLE attribute_values
  ADD COLUMN IF NOT EXISTS color_hex text;

-- CHECK формата '#RRGGBB' идемпотентно. NULL проходит проверку (NULL-семантика
-- CHECK: результат UNKNOWN не считается нарушением) — цвет без hex допустим.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attribute_values_color_hex_chk'
  ) THEN
    ALTER TABLE attribute_values ADD CONSTRAINT attribute_values_color_hex_chk
      CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

COMMENT ON COLUMN attribute_values.color_hex IS
  'HEX-код значения справочника «Цвет» в формате #RRGGBB; NULL — не задан';

INSERT INTO schema_migrations (version, name)
VALUES ('0036', 'attribute_values_color_hex')
ON CONFLICT DO NOTHING;
