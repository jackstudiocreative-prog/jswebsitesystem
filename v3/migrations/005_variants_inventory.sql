-- Review before applying to Staging. Requires 004. Additive: no column, table or row is dropped.
-- Every existing product receives one default variant that keeps its current SKU, MYR price and
-- inventory. Existing stock is recorded as one 'migration' ledger entry so history starts balanced.

-- Products: option names (max 3, e.g. Color, Size) and an explicit featured image.
ALTER TABLE products ADD COLUMN option_names text[] NOT NULL DEFAULT '{}' CHECK(cardinality(option_names)<=3),
 ADD COLUMN featured_media_id bigint REFERENCES media(id);

-- Searchable library label (original file name). Display text only, never used as a storage key.
ALTER TABLE media ADD COLUMN label text NOT NULL DEFAULT '' CHECK(length(label)<=120);
ALTER TABLE upload_intents ADD COLUMN label text NOT NULL DEFAULT '' CHECK(length(label)<=120);

CREATE TABLE product_variants (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 product_id bigint NOT NULL REFERENCES products(id),
 option_values text[] NOT NULL DEFAULT '{}' CHECK(cardinality(option_values)<=3),
 sku text CHECK(sku IS NULL OR length(sku) BETWEEN 1 AND 80),
 sku_key text GENERATED ALWAYS AS (lower(sku)) STORED,
 price_minor integer NOT NULL DEFAULT 0 CHECK(price_minor>=0),
 inventory integer NOT NULL DEFAULT 0 CHECK(inventory>=0),
 position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 active boolean NOT NULL DEFAULT true,
 media_id bigint REFERENCES media(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 -- Deferred so a single save can swap SKUs or option values between variants.
 CONSTRAINT product_variants_sku_unique UNIQUE(sku_key) DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT product_variants_options_unique UNIQUE(product_id,option_values) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX product_variants_product ON product_variants(product_id,position,id);

-- Append-only stock ledger. actor is empty only for the one-off migration opening balance.
CREATE TABLE inventory_adjustments (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 variant_id bigint NOT NULL REFERENCES product_variants(id),
 product_id bigint NOT NULL REFERENCES products(id),
 delta integer NOT NULL CHECK(delta<>0),
 quantity_before integer NOT NULL CHECK(quantity_before>=0),
 quantity_after integer NOT NULL CHECK(quantity_after>=0 AND quantity_after=quantity_before+delta),
 reason text NOT NULL CHECK(reason IN ('initial','migration','received','stocktake','correction','damaged','returned','transfer','other')),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=500),
 actor text REFERENCES staff(subject),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(actor IS NOT NULL OR reason='migration')
);
CREATE INDEX inventory_adjustments_variant ON inventory_adjustments(variant_id,id);
CREATE INDEX inventory_adjustments_product ON inventory_adjustments(product_id,id);

-- Compatibility backfill: one default variant per existing product, nothing lost.
INSERT INTO product_variants(product_id,option_values,sku,price_minor,inventory,position,active)
 SELECT id,'{}',sku,price_minor,inventory,0,true FROM products ORDER BY id;
INSERT INTO inventory_adjustments(variant_id,product_id,delta,quantity_before,quantity_after,reason,note)
 SELECT id,product_id,inventory,0,inventory,'migration','Opening balance from Migration 005' FROM product_variants WHERE inventory>0;
UPDATE products p SET featured_media_id=(SELECT media_id FROM product_media m WHERE m.product_id=p.id ORDER BY position LIMIT 1);
UPDATE media SET label=left(regexp_replace(object_key,'^.*/',''),120);

-- Ledger integrity: committed stock must equal the sum of its ledger entries, so inventory cannot
-- change without a recorded adjustment. Checked at commit; re-reads the row for multi-step saves.
CREATE FUNCTION inventory_ledger_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE vid bigint := (to_jsonb(NEW)->>TG_ARGV[0])::bigint; stock integer; total bigint;
BEGIN
 SELECT inventory INTO stock FROM product_variants WHERE id=vid;
 SELECT coalesce(sum(delta),0) INTO total FROM inventory_adjustments WHERE variant_id=vid;
 IF stock IS DISTINCT FROM total THEN
  RAISE EXCEPTION 'Inventory for variant % must change through a recorded adjustment',vid USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER product_variants_ledger AFTER INSERT OR UPDATE OF inventory ON product_variants
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_ledger_check('id');
CREATE CONSTRAINT TRIGGER inventory_adjustments_ledger AFTER INSERT ON inventory_adjustments
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_ledger_check('variant_id');

DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['product_variants','inventory_adjustments'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r);
   END IF;
  END LOOP;
  EXECUTE format('CREATE POLICY server_access ON public.%I TO jackstudio_api USING (true) WITH CHECK (true)',t);
 END LOOP;
END $$;
-- Variants: no DELETE (deactivate instead). Ledger: SELECT/INSERT only (append-only history).
GRANT SELECT,INSERT,UPDATE ON product_variants TO jackstudio_api;
GRANT SELECT,INSERT ON inventory_adjustments TO jackstudio_api;
GRANT USAGE ON SEQUENCE product_variants_id_seq,inventory_adjustments_id_seq TO jackstudio_api;
-- No staff/audit mutation grants, no browser grants, no ownership or BYPASSRLS.
