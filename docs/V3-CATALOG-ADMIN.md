# V3 catalogue admin — Phase 1 review

## Branch and release boundary

This branch is based on PR #6 (`dfa390c`), preserving its invitation callback, first password,
recovery and MFA work. PR #6 is still open. Review/merge #6 before this PR; this PR targets staging
and includes #6 until it lands. Do not deploy or merge while the current release pause remains in
place: staging merges can trigger Vercel Preview. main, Shopify, Production and existing images
are untouched. Real invitations, SMTP setup and hosted browser E2E remain paused.

## Implemented (code and automated tests; not yet deployed)

- Responsive Jack Studio forest/sage dashboard and seven navigation destinations. Counts come
  from PostgreSQL; no revenue, customer or order fixtures are presented as live data.
- Products: server-side title/SKU search, status/collection filter, pagination, create/edit/archive,
  MYR price in integer sen, unique case-insensitive SKU, non-negative inventory, status, handle,
  description, multiple collections, up to 20 ordered images and per-image alt text.
- Collections: create/edit/status, numeric display order (lower first, then ID), associated product
  list and add/remove associations. Product row revisions protect concurrent association edits.
- Media: existing signed upload and server verification remain intact. Ready library assets can
  be linked to products. Private originals get five-minute authenticated Cloudinary download URLs
  only after JWT/MFA/active staff checks. These bearer URLs must not be shared or logged; expiry
  stops new requests but cannot revoke already downloaded bytes. No public storefront image publishing.
- Viewer can read/preview but cannot mutate. Admin/Editor can change catalogue. Every catalogue
  write runs in a transaction with audit insertion; revision mismatch returns 409 and requires reload.
  Invalid relation/media/unique SKU failures roll back the whole edit. No delete-product endpoint.
- DOM rendering uses textContent for catalogue data. Auth tokens stay in the existing memory storage.
  Existing TLS CA/verify-full and backend authorization are unchanged. Browser never uses secret keys.

## Schema / Migration 004 (REVIEW REQUIRED; not run on hosted database)

| Table | Additions |
|---|---|
| products | price_minor integer >=0 (MYR sen), sku nullable text <=80 unique ignoring case, inventory integer >=0, revision integer default 1 |
| collections | position integer >=0, revision integer default 1 |
| product_collections | product_id + collection_id composite primary key, foreign keys, RLS enabled, API role only |
| product_media | Existing table reused: product_id/media_id, ordered position, alt |

Migration backfills the new many-to-many table from existing products.collection_id without
removing that legacy column. The API keeps the legacy primary collection synchronized when it
changes memberships. Existing rows retain title/status/description/media; price/inventory default
to zero because no price/stock existed in V3. Review these values before making products active.
Single-product SKU/stock is the current model; variants/reservations are future work.

New grants: UPDATE products/collections; SELECT/INSERT/DELETE product_collections;
INSERT/DELETE product_media. Existing staff read-only and audit append-only restrictions remain.
No grants to anon/authenticated; no BYPASSRLS, ownership or secret changes.
The API role is a trusted backend role; per-employee roles are enforced server-side, as in V3.

Before a later authorized release: review SQL and grants, take a recoverable Staging backup,
apply only 004 through the established migration ledger using an operator account (never runtime),
verify old row/image counts and memberships, check runtime grants and anon/authenticated denial,
then release the compatible app. No startup/CI code connects to the hosted project for migration.
The app requires 004; deploying it before the reviewed schema update is unsupported.
Rollback application code to the previous release and retain additive schema/data; do not drop
columns or junctions to undo the release. Reconcile memberships before any old version writes
collection_id directly. Restore backup into a separate database first if data recovery is needed.

## API

All private routes require Bearer JWT, MFA aal2 and active staff. All mutations require Admin/Editor.
GET /api/v3/dashboard returns actual catalogue counts.
GET /api/v3/{products,collections,media}?paged=true&limit=25&offset=0&q=...&status=...
returns {items,total,limit,offset}; products also accepts collection=<id>. Limits 1–100.
Legacy unpaged list responses remain arrays capped at 200.
GET /api/v3/{products,collections}/:id returns fields plus relations.
POST creates; PATCH /:id edits and requires the last integer revision.
Product payload supports collection_ids, media:[{media_id,alt}], price_minor,sku,inventory.
Collection payload supports title,slug,description,status,position. Associations use product PATCH.
GET /api/v3/media/:id/preview returns a five-minute private URL for ready assets.
Storefront remains checkout-disabled and exposes only active products in active collections.
No mock commerce endpoints were added.

## Validation and known limits

Automated tests cover API persistence/permissions, rollback, SKU conflicts, stale revisions,
search/filter/pagination, archive visibility, migration preservation, RLS and private preview signing.
DOM tests use actual admin markup and form/navigation code (not live employees), plus existing
invitation/MFA tests. CI uses PostgreSQL 17; local tests use disposable PostgreSQL-WASM.
Cloudinary delivery, actual Supabase accounts, real SMTP, responsive browser appearance and
cross-browser E2E still need an authorized later acceptance run. No hosted success is claimed.

Customers, Orders and Settings editor are explicitly unavailable destinations. Also unfinished:
variant options/SKUs, stock reservation/adjustment ledger, bulk import/export, image optimization,
public storefront image delivery, configurable currency, section Website Editor, checkout/payment,
shipping/refunds, membership integration. No false financial numbers or customer records are seeded.
Collection/media selectors currently load all pages; very large libraries need searchable pickers.
Preview originals use Cloudinary authenticated API delivery (not CDN thumbnails); optimization is
next-phase work, with provider usage cost to assess before large libraries.

Next: review Phase 1 and 004; then variants/inventory ledger and searchable media pickers;
then structured Website Editor. Real payment/customer workflows follow separate contracts and review.

Reference: https://cloudinary.com/documentation/control_access_to_media
