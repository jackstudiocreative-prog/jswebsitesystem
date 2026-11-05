# V3 Phase 3 — Website Editor

## Branch and release boundary

Stacked on PR #8 (`update/v3-variants-inventory`). Merge order: **#6 → #7 → #8 → this PR**.
Not merged, not deployed, **Migration 006 not run** on the hosted database. main, Production,
Shopify and the live website are untouched. No payments, no customer data.

## Implemented (code + automated tests; not deployed)

- **Pages** (new sidebar item "Website"): search, status filter (Draft / Published / Unpublished
  changes), pagination. Create blank or from a template: Home, Brand Story, Our Services,
  Corporate Solution, Outlets, Contact. Template copy is the existing V2 page content.
- **Section builder**: Hero, Image + Text, Product Grid, Banner, Text. Add, edit, hide/show,
  duplicate, move up/down and remove; up to 30 sections. Forms are generated from one shared
  schema (`v3/shared/page-schema.mjs`) that the API also uses for validation, so unknown fields,
  unsafe links (`javascript:`, `//host`, `http:`) and missing required text are rejected.
- **Images** via the paged Media Picker (Phase 2). **Product Grid** shows a collection or hand-picked
  products in order; only active products in an active collection ever appear.
- **Preview**: Desktop 1280 / Tablet 768 / Mobile 390, showing current unsaved edits (validated,
  nothing written), the saved draft, or the live version. Rendered in a sandboxed iframe.
- **Save draft → Publish → Unpublish**. Each publish appends an immutable version. Any version can be
  restored as the draft (rollback) and then published; history is never rewritten.
- **SEO and URLs**: page title, URL slug, SEO title (≤70) and description (≤160) with counters.
  Changing the URL of a published page creates a redirect from the old URL automatically.
- **Concurrency**: every save/publish/unpublish/restore locks the page row and checks its revision;
  stale editors get "Changed by another staff member. Reload before saving."
- **Public page** `/pages/<slug>` (staging, `noindex`): published content only, via
  `GET /api/v3/storefront/pages/:slug`; follows redirects. Hidden sections, drafts and private image
  URLs are never exposed.
- **Dashboard**: published pages and pages with drafts.

Visual style reuses the V2 storefront (`/styles.css`: cream ground, Impact display headings, Inter body,
#a97845 button) with section styles in `v3/admin/page-sections.css`.

## Migration 006 (REVIEW REQUIRED; not run on hosted database)

| Table | Purpose |
|---|---|
| `pages` | draft: slug (unique), title, SEO fields, `sections jsonb`, `published_revision_id`, `has_unpublished_changes`, `revision`, `updated_by` |
| `page_revisions` | append-only published snapshots (number, slug, title, SEO, sections, published_by, published_at) |
| `page_redirects` | old slug → page, created when a published page's slug changes |

A composite foreign key guarantees a page can only point at its own revision. Additive only; no
existing table changes; no pages are seeded.

**Grants (`jackstudio_api` only)**: `pages` SELECT/INSERT/UPDATE (no DELETE — unpublish instead);
`page_revisions` SELECT/INSERT (append-only); `page_redirects` SELECT/INSERT/DELETE; sequence usage.
RLS enabled with the `server_access` policy; anon/authenticated revoked; no BYPASSRLS or ownership.

**Release**: after 004 and 005, apply 006 through the migration ledger with the operator account,
verify grants and anon/authenticated denial, then release. Rollback: return to the #8 app and keep the
tables (they are unused by older code).

## API

Private (Bearer JWT, MFA aal2, active staff; writes need Admin/Editor):
`GET /api/v3/pages?paged&q&status`, `POST /api/v3/pages`, `GET|PATCH /api/v3/pages/:id`,
`GET /api/v3/pages/:id/preview?source=draft|live`, `POST /api/v3/pages/preview` (unsaved, writes nothing),
`POST /api/v3/pages/:id/publish|unpublish`, `POST /api/v3/pages/:id/revisions/:rid/restore`.
All writes send `{revision}`. Public: `GET /api/v3/storefront/pages/:slug` → `{page}` or `{redirect_to}`.

## Validation and known limits

Automated: schema rules for every type and link, draft privacy, preview product rule, publish/
unpublish/restore/rollback, redirects, stale revisions, roles, append-only history, audit trail,
Migration 006 grants and FK, renderer escaping, and DOM tests on the real admin markup.
Visual check in a local headless browser with seeded data (desktop, tablet, mobile, public page).

Known limits: public pages show image placeholders because product/page originals are private;
public image delivery (Cloudinary public derivatives) is a later decision. Ordering uses move
up/down buttons (accessible) rather than drag-and-drop. Site navigation menus and a page-level
scheduled publish are not included. The public page is a staging shell, not the full storefront.
