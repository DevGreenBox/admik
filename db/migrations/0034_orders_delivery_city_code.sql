-- =============================================================================
-- 0034_orders_delivery_city_code.sql  (боевой аудит СДЭК 2026-07-09, фикс 4)
-- Числовой код города СДЭК получателя на заказе (orders.delivery_city_code).
--
-- Документация apidoc.cdek.ru (POST /v2/orders): to_location для тарифов
-- «до двери» требует address (обязателен) + идентификацию города
-- (code | city | postal_code). Раньше заказ хранил только строковое
-- delivery_city — накладная курьерки уходила без надёжной идентификации города.
-- Витрина уже шлёт delivery.cityCode (из автокомплита /cities); теперь он
-- персистится и используется buildPayload (lib/cdek/services/order.ts).
--
-- NULLable: код города опционален (fallback — строковое delivery_city).
-- Универсально (код города СДЭК, не привязан к конкретному магазину).
--
-- Идемпотентно/аддитивно: ADD COLUMN IF NOT EXISTS. GRANT не нужен: права на
-- orders выданы ранее (полный DML admik_app), новые столбцы наследуют табличные
-- привилегии. Запись в schema_migrations — ON CONFLICT DO NOTHING.
-- =============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_city_code integer;

INSERT INTO schema_migrations (version, name)
VALUES ('0034', 'orders_delivery_city_code')
ON CONFLICT DO NOTHING;
