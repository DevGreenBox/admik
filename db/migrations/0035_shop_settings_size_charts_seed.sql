-- =============================================================================
-- 0035_shop_settings_size_charts_seed.sql
-- Идемпотентный seed ключа настроек 'size_charts' (docs/11 §5.4.2).
--
-- Полностью по образцу 0020_shop_settings_seed.sql: сидируем раздел ПУСТЫМ
-- объектом '{}'::jsonb. Пустой объект = «нет оверрайда» → при чтении
-- (mergeSettings) раздел падает на платформенный дефолт { charts: [] }, то есть
-- блок размерной сетки на витрине просто не рисуется. Администратор получает
-- готовую строку для правки через /admin/settings/size-charts без ручного INSERT.
--
-- МУЛЬТИТЕНАНТНОСТЬ (docs/02, ADR-003). В миграции НЕТ и не может быть значений
-- конкретного магазина: набор сеток, колонок и цифр у каждого ИМ свой. Реальные
-- размерные сетки магазина «THE CASE» вынесены в db/seed/the-case-size-charts.sql
-- и накатываются вручную на конкретный инстанс (контент магазина ≠ схема).
--
-- ON CONFLICT (setting_key) DO NOTHING (НЕ DO UPDATE): повторный накат миграций
-- НЕ затирает уже отредактированное администратором значение.
-- =============================================================================

INSERT INTO shop_settings (setting_key, value)
VALUES
  ('size_charts', '{}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO schema_migrations (version, name)
VALUES ('0035', 'shop_settings_size_charts_seed')
ON CONFLICT DO NOTHING;
