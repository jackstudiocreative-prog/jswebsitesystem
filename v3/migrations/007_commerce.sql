-- Review before applying to Staging. Requires 006. Orders, payments (eGHL, same gateway as the Shopify
-- store) and shipping rates copied from the Shopify delivery profiles. Additive for existing data.

-- Shipping: Shopify profiles "General profile" (default) and "Luggage Shipping Fees".
ALTER TABLE products ADD COLUMN shipping_profile text NOT NULL DEFAULT 'general' CHECK(shipping_profile IN ('general','luggage')),
 ADD COLUMN weight_grams integer NOT NULL DEFAULT 0 CHECK(weight_grams BETWEEN 0 AND 100000);
CREATE TABLE shipping_rates (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 profile text NOT NULL CHECK(profile IN ('general','luggage')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
 price_minor integer NOT NULL CHECK(price_minor>=0),
 min_subtotal_minor integer CHECK(min_subtotal_minor IS NULL OR min_subtotal_minor>=0),
 min_weight_grams integer CHECK(min_weight_grams IS NULL OR min_weight_grams>=0),
 max_weight_grams integer CHECK(max_weight_grams IS NULL OR max_weight_grams>=0),
 active boolean NOT NULL DEFAULT true
);
-- Copied from Shopify (Malaysia, all states). Store configuration, not demo data.
INSERT INTO shipping_rates(profile,name,price_minor,min_subtotal_minor,min_weight_grams,max_weight_grams) VALUES
 ('general','Gift Box, Gift Card, Name Engraving Available. Chat With Us for Details.',0,4900,NULL,NULL),
 ('general','Gift Box, Gift Card, Name Engraving Available. Chat With Us for Details.',500,NULL,NULL,NULL),
 ('luggage','Luggage',2690,NULL,1000,50000);

CREATE SEQUENCE order_number_seq START 50001;
CREATE TABLE orders (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 number text NOT NULL UNIQUE,
 idempotency_key uuid NOT NULL UNIQUE,
 access_token_hash text NOT NULL,
 status text NOT NULL DEFAULT 'pending_payment' CHECK(status IN ('pending_payment','paid','cancelled','expired')),
 fulfillment_status text NOT NULL DEFAULT 'unfulfilled' CHECK(fulfillment_status IN ('unfulfilled','fulfilled')),
 needs_attention boolean NOT NULL DEFAULT false,
 attention_note text NOT NULL DEFAULT '',
 customer_name text NOT NULL CHECK(length(customer_name) BETWEEN 1 AND 120),
 email text NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
 phone text NOT NULL CHECK(length(phone) BETWEEN 6 AND 30),
 address_line1 text NOT NULL CHECK(length(address_line1) BETWEEN 1 AND 200),
 address_line2 text NOT NULL DEFAULT '' CHECK(length(address_line2)<=200),
 city text NOT NULL CHECK(length(city) BETWEEN 1 AND 100),
 postcode text NOT NULL CHECK(postcode ~ '^[0-9]{5}$'),
 state text NOT NULL,
 country text NOT NULL DEFAULT 'MY' CHECK(country='MY'),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=500),
 currency text NOT NULL DEFAULT 'MYR' CHECK(currency='MYR'),
 subtotal_minor integer NOT NULL CHECK(subtotal_minor>=0),
 shipping_minor integer NOT NULL CHECK(shipping_minor>=0),
 total_minor integer NOT NULL CHECK(total_minor=subtotal_minor+shipping_minor),
 refunded_minor integer NOT NULL DEFAULT 0 CHECK(refunded_minor BETWEEN 0 AND total_minor),
 shipping_names text NOT NULL DEFAULT '',
 tracking_number text NOT NULL DEFAULT '' CHECK(length(tracking_number)<=80),
 revision integer NOT NULL DEFAULT 1,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 paid_at timestamptz,
 cancelled_at timestamptz,
 fulfilled_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_status_expiry ON orders(status,expires_at);
CREATE INDEX orders_email ON orders(lower(email));
CREATE TABLE order_lines (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id bigint NOT NULL REFERENCES orders(id),
 product_id bigint NOT NULL REFERENCES products(id),
 variant_id bigint NOT NULL REFERENCES product_variants(id),
 title text NOT NULL,
 variant_title text NOT NULL DEFAULT '',
 sku text,
 unit_price_minor integer NOT NULL CHECK(unit_price_minor>=0),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 20),
 line_total_minor integer NOT NULL CHECK(line_total_minor=unit_price_minor*quantity),
 UNIQUE(order_id,variant_id)
);
CREATE TABLE payments (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id bigint NOT NULL REFERENCES orders(id),
 provider text NOT NULL CHECK(provider IN ('eghl','mock')),
 payment_ref text NOT NULL UNIQUE CHECK(length(payment_ref) BETWEEN 1 AND 20),
 amount_minor integer NOT NULL CHECK(amount_minor>0),
 status text NOT NULL DEFAULT 'initiated' CHECK(status IN ('initiated','pending','succeeded','failed')),
 provider_txn_id text,
 auth_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Append-only evidence of every gateway message, verified or not. Card data is never stored.
CREATE TABLE payment_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 payment_id bigint REFERENCES payments(id),
 source text NOT NULL CHECK(source IN ('callback','return')),
 verified boolean NOT NULL,
 txn_status text,
 outcome text NOT NULL,
 payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE refunds (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id bigint NOT NULL REFERENCES orders(id),
 amount_minor integer NOT NULL CHECK(amount_minor>0),
 reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 80),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=500),
 restocked boolean NOT NULL DEFAULT false,
 actor text NOT NULL REFERENCES staff(subject),
 created_at timestamptz NOT NULL DEFAULT now()
);

-- Stock ledger: checkout reservations ('sale') and releases ('sale_released') are system entries
-- linked to the order; staff entries still require an actor.
ALTER TABLE inventory_adjustments ADD COLUMN order_id bigint REFERENCES orders(id);
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='inventory_adjustments'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%reason%' LOOP
  EXECUTE format('ALTER TABLE inventory_adjustments DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE inventory_adjustments ADD CONSTRAINT inventory_adjustments_reason CHECK(reason IN ('initial','migration','received','stocktake','correction','damaged','returned','transfer','other','sale','sale_released')),
 ADD CONSTRAINT inventory_adjustments_actor CHECK(actor IS NOT NULL OR reason IN ('migration','sale','sale_released')),
 ADD CONSTRAINT inventory_adjustments_order CHECK((reason IN ('sale','sale_released'))=(order_id IS NOT NULL) OR (reason='returned' AND order_id IS NOT NULL));
CREATE INDEX inventory_adjustments_order_idx ON inventory_adjustments(order_id) WHERE order_id IS NOT NULL;

DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['shipping_rates','orders','order_lines','payments','payment_events','refunds'] LOOP
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
REVOKE ALL ON SEQUENCE order_number_seq FROM PUBLIC;
GRANT SELECT ON shipping_rates TO jackstudio_api;
GRANT SELECT,INSERT,UPDATE ON orders,payments TO jackstudio_api;
GRANT SELECT,INSERT ON order_lines,payment_events,refunds TO jackstudio_api;
GRANT USAGE ON SEQUENCE order_number_seq,orders_id_seq,order_lines_id_seq,payments_id_seq,payment_events_id_seq,refunds_id_seq TO jackstudio_api;
-- No DELETE anywhere; order lines, gateway events and refunds are append-only. Shipping rates are
-- read-only at runtime (changed by migration/operator). No browser grants, ownership or BYPASSRLS.
