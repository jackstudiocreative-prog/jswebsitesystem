-- Review before applying to Staging. Requires 006. Additive: no existing table, column or row changes.
-- Online Store themes: a theme holds the storefront header, home page sections, footer and global
-- style settings as validated JSON. Exactly one theme can be live; the others form the theme library.
-- Like Shopify, saving the live theme changes the live storefront; edit a copy to work privately.
-- No theme is seeded; staff add one from a preset in the admin.

CREATE TABLE themes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
 preset text NOT NULL CHECK(preset ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(preset)<=40),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 is_live boolean NOT NULL DEFAULT false,
 archived boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1,
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by text REFERENCES staff(subject),
 CHECK(NOT (is_live AND archived))
);
-- At most one live theme.
CREATE UNIQUE INDEX themes_one_live ON themes(is_live) WHERE is_live;

ALTER TABLE public.themes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.themes FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.themes FROM %I',r); END IF;
 END LOOP;
END $$;
CREATE POLICY server_access ON public.themes TO jackstudio_api USING (true) WITH CHECK (true);
-- No DELETE: removing a theme archives it, so audit history keeps its ID.
GRANT SELECT,INSERT,UPDATE ON themes TO jackstudio_api;
GRANT USAGE ON SEQUENCE themes_id_seq TO jackstudio_api;
-- No staff/audit mutation grants, no browser grants, no ownership or BYPASSRLS.
