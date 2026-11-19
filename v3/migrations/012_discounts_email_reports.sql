-- Review before applying to Staging. Requires 011. Additive except the orders total rule, which now
-- subtracts discounts (existing orders have discount_minor = 0, so they still satisfy it).
-- 1. Discounts: codes and automatic discounts (percentage, fixed amount, free shipping).
-- 2. Discounts used by each order (kept as a snapshot: later edits to a discount never change an order).
-- 3. Email outbox: one row per message (dedupe_key), retry schedule and the provider's message id.
-- Rollback (only while no order has a discount):
--   DROP TABLE order_discounts; DROP TABLE discounts;
--   ALTER TABLE orders DROP CONSTRAINT orders_total_rule; ALTER TABLE orders DROP COLUMN discount_minor;
--   ALTER TABLE orders ADD CONSTRAINT orders_total_minor_check CHECK(total_minor=subtotal_minor+shipping_minor);
--   ALTER TABLE email_outbox DROP COLUMN dedupe_key, DROP COLUMN next_attempt_at, DROP COLUMN provider_id;
CREATE TABLE discounts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 code text CHECK(code IS NULL OR code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 kind text NOT NULL CHECK(kind IN ('percentage','fixed','free_shipping')),
 value integer NOT NULL DEFAULT 0 CHECK(value>=0),
 applies_to text NOT NULL DEFAULT 'all' CHECK(applies_to IN ('all','collections','products')),
 collection_ids bigint[] NOT NULL DEFAULT '{}',
 product_ids bigint[] NOT NULL DEFAULT '{}',
 min_subtotal_minor integer NOT NULL DEFAULT 0 CHECK(min_subtotal_minor>=0),
 starts_at timestamptz NOT NULL DEFAULT now(),
 ends_at timestamptz CHECK(ends_at IS NULL OR ends_at>starts_at),
 usage_limit integer CHECK(usage_limit IS NULL OR usage_limit>0),
 once_per_customer boolean NOT NULL DEFAULT false,
 used_count integer NOT NULL DEFAULT 0 CHECK(used_count>=0),
 active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1,
 created_by text NOT NULL REFERENCES staff(subject),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(kind<>'percentage' OR value BETWEEN 1 AND 100),
 CHECK(kind<>'fixed' OR value>0),
 CHECK(kind<>'free_shipping' OR value=0),
 CHECK(usage_limit IS NULL OR used_count<=usage_limit)
);
CREATE UNIQUE INDEX discounts_code ON discounts(code) WHERE code IS NOT NULL;
CREATE TABLE order_discounts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id bigint NOT NULL REFERENCES orders(id),
 discount_id bigint NOT NULL REFERENCES discounts(id),
 code text,
 title text NOT NULL,
 kind text NOT NULL,
 amount_minor integer NOT NULL CHECK(amount_minor>=0),
 released boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,discount_id)
);
CREATE INDEX order_discounts_discount ON order_discounts(discount_id);
ALTER TABLE orders ADD COLUMN discount_minor integer NOT NULL DEFAULT 0 CHECK(discount_minor>=0);
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='orders'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%total_minor = (subtotal_minor + shipping_minor)%' LOOP
  EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE orders ADD CONSTRAINT orders_total_rule CHECK(total_minor=subtotal_minor+shipping_minor-discount_minor AND discount_minor<=subtotal_minor+shipping_minor);
ALTER TABLE email_outbox ADD COLUMN dedupe_key text, ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN provider_id text CHECK(provider_id IS NULL OR length(provider_id)<=200);
CREATE UNIQUE INDEX email_outbox_dedupe ON email_outbox(dedupe_key) WHERE dedupe_key IS NOT NULL;
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['discounts','order_discounts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r); END IF;
  END LOOP;
  EXECUTE format('CREATE POLICY server_access ON public.%I TO jackstudio_api USING (true) WITH CHECK (true)',t);
 END LOOP;
END $$;
-- Discounts are deactivated, never deleted (orders keep their snapshot either way).
GRANT SELECT,INSERT,UPDATE ON discounts,order_discounts TO jackstudio_api;
GRANT USAGE ON SEQUENCE discounts_id_seq,order_discounts_id_seq TO jackstudio_api;
