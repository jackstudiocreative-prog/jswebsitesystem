-- Review before applying to Staging. Requires 007. Additive: abuse protection and an email outbox.

-- Shared fixed-window counters, so limits hold across serverless instances. Keys are hashes
-- (route + client IP or email); no raw IP addresses are stored.
CREATE TABLE rate_limits (
 key text NOT NULL CHECK(key ~ '^[a-z-]+:[0-9a-f]{64}$'),
 window_start timestamptz NOT NULL,
 hits integer NOT NULL CHECK(hits>=1),
 PRIMARY KEY(key,window_start)
);
CREATE INDEX rate_limits_window ON rate_limits(window_start);

-- Transactional emails queued with the order change that caused them (same transaction).
-- Nothing is sent until an email provider is configured; staff can see each message's status.
CREATE TABLE email_outbox (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id bigint NOT NULL REFERENCES orders(id),
 kind text NOT NULL CHECK(kind IN ('order_paid','order_fulfilled','order_refunded')),
 recipient text NOT NULL CHECK(length(recipient) BETWEEN 3 AND 254),
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 20000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_error text NOT NULL DEFAULT '' CHECK(length(last_error)<=500),
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz
);
CREATE INDEX email_outbox_pending ON email_outbox(status,created_at) WHERE status<>'sent';

DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['rate_limits','email_outbox'] LOOP
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
-- Rate counters are disposable (DELETE allowed for clean-up). Outbox rows are never deleted.
GRANT SELECT,INSERT,UPDATE,DELETE ON rate_limits TO jackstudio_api;
GRANT SELECT,INSERT,UPDATE ON email_outbox TO jackstudio_api;
GRANT USAGE ON SEQUENCE email_outbox_id_seq TO jackstudio_api;
