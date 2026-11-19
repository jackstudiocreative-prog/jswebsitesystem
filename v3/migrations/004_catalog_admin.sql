-- Review before applying to Staging. Additive catalogue extension; existing rows/assets survive.
ALTER TABLE products ADD COLUMN price_minor integer NOT NULL DEFAULT 0 CHECK(price_minor>=0),
 ADD COLUMN sku text CHECK(sku IS NULL OR length(sku) BETWEEN 1 AND 80),
 ADD COLUMN inventory integer NOT NULL DEFAULT 0 CHECK(inventory>=0),
 ADD COLUMN revision integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX products_sku_unique ON products(lower(sku)) WHERE sku IS NOT NULL;
ALTER TABLE collections ADD COLUMN position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 ADD COLUMN revision integer NOT NULL DEFAULT 1;
CREATE TABLE product_collections (
 product_id bigint NOT NULL REFERENCES products(id),
 collection_id bigint NOT NULL REFERENCES collections(id),
 PRIMARY KEY(product_id,collection_id)
);
INSERT INTO product_collections SELECT id,collection_id FROM products WHERE collection_id IS NOT NULL;
ALTER TABLE product_collections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_collections FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON product_collections FROM %I',r);
  END IF;
 END LOOP;
END $$;
CREATE POLICY server_access ON product_collections TO jackstudio_api USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,DELETE ON product_collections TO jackstudio_api;
GRANT UPDATE ON products,collections TO jackstudio_api;
GRANT INSERT,DELETE ON product_media TO jackstudio_api;
-- No new staff/audit mutation grants, no browser grants, no ownership or BYPASSRLS.
