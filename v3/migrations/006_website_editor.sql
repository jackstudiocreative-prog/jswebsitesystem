-- Review before applying to Staging. Requires 005. Additive: no existing table, column or row changes.
-- Website Editor: one editable draft per page, append-only published snapshots, slug redirects.
-- No page content is seeded; staff create pages (optionally from templates in the admin).

CREATE TABLE pages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug)<=80),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 seo_title text NOT NULL DEFAULT '' CHECK(length(seo_title)<=70),
 seo_description text NOT NULL DEFAULT '' CHECK(length(seo_description)<=160),
 sections jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(sections)='array'),
 published_revision_id bigint,
 has_unpublished_changes boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by text REFERENCES staff(subject)
);
CREATE TABLE page_revisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 page_id bigint NOT NULL REFERENCES pages(id),
 number integer NOT NULL CHECK(number>=1),
 slug text NOT NULL,
 title text NOT NULL,
 seo_title text NOT NULL,
 seo_description text NOT NULL,
 sections jsonb NOT NULL CHECK(jsonb_typeof(sections)='array'),
 published_by text NOT NULL REFERENCES staff(subject),
 published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(page_id,number),
 UNIQUE(id,page_id)
);
-- The live revision must belong to the same page.
ALTER TABLE pages ADD CONSTRAINT pages_live_revision FOREIGN KEY (published_revision_id,id) REFERENCES page_revisions(id,page_id);
-- Old URL -> page, created when a published page's slug changes. A slug is either a page or a redirect.
CREATE TABLE page_redirects (
 from_slug text PRIMARY KEY CHECK(from_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(from_slug)<=80),
 page_id bigint NOT NULL REFERENCES pages(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX page_redirects_page ON page_redirects(page_id);

DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['pages','page_revisions','page_redirects'] LOOP
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
-- Pages: no DELETE (unpublish instead). Revisions: append-only history. Redirects: managed by the API.
GRANT SELECT,INSERT,UPDATE ON pages TO jackstudio_api;
GRANT SELECT,INSERT ON page_revisions TO jackstudio_api;
GRANT SELECT,INSERT,DELETE ON page_redirects TO jackstudio_api;
GRANT USAGE ON SEQUENCE pages_id_seq,page_revisions_id_seq TO jackstudio_api;
-- No staff/audit mutation grants, no browser grants, no ownership or BYPASSRLS.
