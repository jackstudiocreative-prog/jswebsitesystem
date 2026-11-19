-- Review before applying to Staging. Requires 013. Additive only.
-- Customer records for the staff workspace, imported from Shopify's customer CSV export (and later
-- from JS Membership). These are records for staff, not customer login accounts: nothing here lets a
-- shopper see orders, and no order is linked to a shopper's account by email.
-- Marketing consent is kept exactly as Shopify exported it, with where and when it came from.
-- Rollback: DROP TABLE customers;
CREATE TABLE customers (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shopify_customer_id bigint UNIQUE,
 email text CHECK(email IS NULL OR (length(email) BETWEEN 3 AND 254 AND email=lower(email))),
 first_name text NOT NULL DEFAULT '' CHECK(length(first_name)<=100),
 last_name text NOT NULL DEFAULT '' CHECK(length(last_name)<=100),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40),
 company text NOT NULL DEFAULT '' CHECK(length(company)<=120),
 address1 text NOT NULL DEFAULT '' CHECK(length(address1)<=200),
 address2 text NOT NULL DEFAULT '' CHECK(length(address2)<=200),
 city text NOT NULL DEFAULT '' CHECK(length(city)<=100),
 province_code text NOT NULL DEFAULT '' CHECK(length(province_code)<=10),
 zip text NOT NULL DEFAULT '' CHECK(length(zip)<=20),
 country_code text NOT NULL DEFAULT '' CHECK(country_code='' OR country_code ~ '^[A-Z]{2}$'),
 accepts_email_marketing boolean NOT NULL DEFAULT false,
 accepts_sms_marketing boolean NOT NULL DEFAULT false,
 consent_source text NOT NULL DEFAULT '' CHECK(length(consent_source)<=60),
 consent_recorded_at timestamptz,
 tags text[] NOT NULL DEFAULT '{}',
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 shopify_orders integer NOT NULL DEFAULT 0 CHECK(shopify_orders>=0),
 shopify_spent_minor bigint NOT NULL DEFAULT 0 CHECK(shopify_spent_minor>=0),
 source text NOT NULL DEFAULT 'shopify' CHECK(source IN ('shopify','staff')),
 imported_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(email IS NOT NULL OR phone<>'' OR first_name<>'' OR last_name<>'')
);
CREATE UNIQUE INDEX customers_email ON customers(email) WHERE email IS NOT NULL;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customers FROM PUBLIC;
DO $$DECLARE r text;BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.customers FROM %I',r); END IF;
 END LOOP;
END$$;
CREATE POLICY server_access ON customers TO jackstudio_api USING (true) WITH CHECK (true);
-- No DELETE: customer records are kept; removal on request is an operator task.
GRANT SELECT,INSERT,UPDATE ON customers TO jackstudio_api;
GRANT USAGE ON SEQUENCE customers_id_seq TO jackstudio_api;
