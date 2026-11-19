-- Review before applying to Staging. Requires 012. Additive only; existing rows keep their meaning.
-- 1. Payment status checks with the gateway (QUERY): 'query' as a gateway message source, the time a
--    payment was last checked, and the payment method the gateway reported (needed for QUERY/REFUND).
-- 2. Refunds: the ledger (refunds, append-only) says whether a refund was only recorded here after
--    staff refunded in the eGHL portal ('recorded') or was sent to eGHL by this system ('gateway').
--    gateway_refunds is the request log for the second kind; a refund reaches the ledger only once
--    the gateway confirms it.
-- 3. Fulfilment: carrier and tracking link; a simple return status per order.
-- 4. order_activity: what staff (and the system) did to each order, readable on the order screen.
--    audit_events stays write-only for the API role.
-- Rollback (only before any gateway refund or return was made):
--   DROP TABLE gateway_refunds; ALTER TABLE refunds DROP COLUMN method;
--   ALTER TABLE orders DROP COLUMN tracking_carrier, DROP COLUMN tracking_url, DROP COLUMN return_status, DROP COLUMN return_note, DROP COLUMN returned_at;
--   ALTER TABLE payments DROP COLUMN last_checked_at, DROP COLUMN pymt_method;
--   DROP TABLE order_activity;
--   DELETE FROM payment_events WHERE source='query'; then restore CHECK(source IN ('callback','return')).
DO $$DECLARE c text;BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='payment_events'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%source%' LOOP
  EXECUTE format('ALTER TABLE payment_events DROP CONSTRAINT %I',c);
 END LOOP;
END$$;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_source CHECK(source IN ('callback','return','query'));
ALTER TABLE payments ADD COLUMN last_checked_at timestamptz,
 ADD COLUMN pymt_method text CHECK(pymt_method IS NULL OR pymt_method ~ '^[A-Z]{2,10}$');
ALTER TABLE refunds ADD COLUMN method text NOT NULL DEFAULT 'recorded' CHECK(method IN ('recorded','gateway'));
CREATE TABLE gateway_refunds (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id bigint NOT NULL REFERENCES orders(id),
 payment_id bigint NOT NULL REFERENCES payments(id),
 amount_minor integer NOT NULL CHECK(amount_minor>0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed','unknown')),
 restock boolean NOT NULL DEFAULT false,
 note text NOT NULL DEFAULT '' CHECK(length(note)<=500),
 gateway_txn_id text CHECK(length(gateway_txn_id)<=80),
 message text NOT NULL DEFAULT '' CHECK(length(message)<=300),
 refund_id bigint REFERENCES refunds(id),
 actor text NOT NULL REFERENCES staff(subject),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gateway_refunds_order ON gateway_refunds(order_id);
ALTER TABLE orders ADD COLUMN tracking_carrier text NOT NULL DEFAULT '' CHECK(length(tracking_carrier)<=60),
 ADD COLUMN tracking_url text NOT NULL DEFAULT '' CHECK(tracking_url='' OR (tracking_url ~ '^https://' AND length(tracking_url)<=300)),
 ADD COLUMN return_status text NOT NULL DEFAULT 'none' CHECK(return_status IN ('none','requested','received','closed')),
 ADD COLUMN return_note text NOT NULL DEFAULT '' CHECK(length(return_note)<=500),
 ADD COLUMN returned_at timestamptz;
CREATE TABLE order_activity (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id bigint NOT NULL REFERENCES orders(id),
 actor text REFERENCES staff(subject),
 action text NOT NULL CHECK(length(action) BETWEEN 1 AND 60),
 detail text NOT NULL DEFAULT '' CHECK(length(detail)<=300),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_activity_order ON order_activity(order_id,id);

DO $$DECLARE t text;r text;BEGIN
 FOREACH t IN ARRAY ARRAY['gateway_refunds','order_activity'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r); END IF;
  END LOOP;
  EXECUTE format('CREATE POLICY server_access ON public.%I TO jackstudio_api USING (true) WITH CHECK (true)',t);
 END LOOP;
END$$;
GRANT SELECT,INSERT,UPDATE ON gateway_refunds TO jackstudio_api;
-- Order activity is append-only: no UPDATE or DELETE.
GRANT SELECT,INSERT ON order_activity TO jackstudio_api;
GRANT USAGE ON SEQUENCE gateway_refunds_id_seq,order_activity_id_seq TO jackstudio_api;
