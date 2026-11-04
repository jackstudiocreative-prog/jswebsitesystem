ALTER TABLE media ADD COLUMN cloudinary_asset_id text UNIQUE;
ALTER TABLE media ADD COLUMN version bigint;
ALTER TABLE media ADD COLUMN width integer;
ALTER TABLE media ADD COLUMN height integer;
ALTER TABLE media ADD COLUMN format text;
CREATE TABLE upload_intents (
 id uuid PRIMARY KEY,
 actor text NOT NULL REFERENCES staff(subject),
 public_id text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 media_id bigint REFERENCES media(id)
);
ALTER TABLE upload_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON upload_intents FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON upload_intents FROM %I',r);
  END IF;
 END LOOP;
END $$;
CREATE POLICY server_access ON upload_intents TO jackstudio_api USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON upload_intents TO jackstudio_api;
GRANT INSERT ON media TO jackstudio_api;
GRANT USAGE ON SEQUENCE media_id_seq TO jackstudio_api;
CREATE INDEX upload_actor_time ON upload_intents(actor,created_at);
