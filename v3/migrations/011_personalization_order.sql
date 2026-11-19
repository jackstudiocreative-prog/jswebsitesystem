-- Review before applying to Staging. Requires 010. Additive; existing rows keep their meaning.
-- 1. Engraving / personalisation settings per product (NULL = not offered).
-- 2. Manual product order inside a collection ("Featured" sort). Existing rows get 0, i.e. newest first
--    until staff arrange them or the Shopify import sets the Shopify collection order.
-- 3. Engraving text on order lines. The same variant may appear on several lines of one order when the
--    engraving differs, so UNIQUE(order_id,variant_id) becomes UNIQUE(order_id,variant_id,personalization)
--    (NULLS NOT DISTINCT keeps "one line per plain variant").
-- Rollback (only while no order has two lines of one variant):
--   ALTER TABLE order_lines DROP CONSTRAINT order_lines_variant_personalization_key;
--   ALTER TABLE order_lines ADD CONSTRAINT order_lines_order_id_variant_id_key UNIQUE(order_id,variant_id);
--   ALTER TABLE order_lines DROP COLUMN personalization; ALTER TABLE product_collections DROP COLUMN position;
--   ALTER TABLE products DROP COLUMN personalization;
ALTER TABLE products ADD COLUMN personalization jsonb CHECK(personalization IS NULL OR jsonb_typeof(personalization)='object');
ALTER TABLE product_collections ADD COLUMN position integer NOT NULL DEFAULT 0 CHECK(position>=0);
ALTER TABLE order_lines ADD COLUMN personalization text CHECK(personalization IS NULL OR char_length(personalization) BETWEEN 1 AND 60);
ALTER TABLE order_lines DROP CONSTRAINT order_lines_order_id_variant_id_key;
ALTER TABLE order_lines ADD CONSTRAINT order_lines_variant_personalization_key UNIQUE NULLS NOT DISTINCT (order_id,variant_id,personalization);
GRANT UPDATE(position) ON product_collections TO jackstudio_api;
