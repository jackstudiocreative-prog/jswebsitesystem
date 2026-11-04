-- Owner runs this migration. The runtime login must be a member of this non-login role.
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='jackstudio_api') THEN
  CREATE ROLE jackstudio_api NOLOGIN NOSUPERUSER NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO jackstudio_api;
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['staff','products','collections','media','product_media','audit_events'] LOOP
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
GRANT SELECT ON staff,products,collections,media,product_media TO jackstudio_api;
GRANT INSERT ON products,collections,audit_events TO jackstudio_api;
GRANT USAGE ON SEQUENCE products_id_seq,collections_id_seq,audit_events_id_seq TO jackstudio_api;
-- No staff promotion, audit modification, DDL, table ownership or service-role key at runtime.
