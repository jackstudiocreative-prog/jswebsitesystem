# V3 Phase 2 — Variants, inventory ledger and media picker

## Branch and release boundary

Stacked on PR #7 (`update/v3-catalog-admin`, `939761f`), which already contains PR #6 (`dfa390c`).
Merge order: **#6 → #7 → this PR**. After #7 merges, retarget this PR to `staging`.
main, Production, Shopify and the live website are untouched. Not merged, not deployed, and no
migration has been run on the hosted Supabase database. No payments and no customer data.
Real staff invitations, SMTP and hosted browser E2E stay in the later acceptance phase.

## Implemented (code + automated tests; not deployed)

- **Variants**: up to 3 options per product (e.g. Color, Size) and up to 100 variants. Each variant
  has its own SKU (unique across all variants, case-insensitive), MYR price (integer sen), stock,
  optional image, display order and active flag. Variants are never deleted; deactivate instead,
  so stock history stays intact. SKUs and option combinations can be swapped in one save.
- **Inventory ledger**: every stock change writes an `inventory_adjustments` row with change,
  quantity before/after, reason, optional note, staff member and time. Reasons: stock received,
  stocktake count, correction, damaged, returned, transfer, other (note required); `initial` and
  `migration` are system reasons. Adjustments run in the request transaction as one atomic statement,
  so stock can never go below zero and concurrent requests cannot overwrite each other.
  A counted quantity ("set to") must include the quantity the employee saw; stale counts return 409.
- **Ledger integrity in the database**: a deferred constraint trigger rejects any commit where a
  variant's stock does not equal the sum of its ledger entries. Even raw SQL with the API role cannot
  change stock without a ledger row. The API role cannot update or delete ledger rows.
- **Product editor**: option names, variant table (create, edit, reorder, deactivate), stock status
  (In stock / Low stock / Out of stock / Inactive), inline "Adjust stock" and per-product history.
  Products without options keep the familiar single price/SKU/stock form.
- **Inventory page** (new sidebar item): search by product or SKU, filter by stock level,
  paginated, adjust inline, and a shared recent-adjustments history.
- **Images**: explicit Featured image plus ordered Gallery, alt text, move up/down, remove.
- **Media picker**: searchable (file name), filter by format and usage, 12 per page,
  multi-select across pages, previews loaded in one batched request per page. The editor no longer
  loads the whole media library. New uploads store the original file name as a searchable label.
- **Dashboard**: adds active variants, low stock and out-of-stock counts.

Low stock = 1–5 units (`shared/catalog.js` `lowStock`). Change that one value if needed.

## Migration 005 (REVIEW REQUIRED; not run on hosted database)

| Change | Detail |
|---|---|
| `products` | + `option_names text[]` (≤3), + `featured_media_id` → media |
| `media`, `upload_intents` | + `label text` (≤120), backfilled from the object key's last segment |
| `product_variants` (new) | option_values, sku (+ generated lower-case `sku_key`), price_minor ≥0, inventory ≥0, position, active, media_id; deferred UNIQUE on SKU and on (product, option values) |
| `inventory_adjustments` (new) | variant, product, delta ≠0, quantity_before/after (≥0, after = before + delta), reason (checked list), note ≤500, actor → staff |
| Trigger | `inventory_ledger_check()` deferred constraint triggers on both tables |

**Compatibility / data preservation**: every existing product gets one default variant with its
current SKU, price and inventory. Existing non-zero stock gets one `migration` ledger row (actor
empty, only allowed for this reason) so history starts balanced. `featured_media_id` is set to each
product's first image. No column, row or image is dropped. Legacy `products.sku/price_minor/inventory`
remain as a synced summary (first active SKU, lowest active price, total active stock), so the
product list and the previous release can still read them.

**Grants (API role `jackstudio_api` only)**: `product_variants` SELECT/INSERT/UPDATE (no DELETE);
`inventory_adjustments` SELECT/INSERT (append-only); sequence usage for both. RLS enabled with the
existing `server_access` policy pattern. Nothing granted to `anon`/`authenticated`; no BYPASSRLS,
ownership or secret changes.

**Before a later authorised release**: review SQL and grants; take a recoverable Staging backup;
apply 004 then 005 through the migration ledger with the operator account (never runtime);
verify product/variant counts, SKU/price/stock per product and that every ledger is balanced
(`SELECT count(*) FROM product_variants v WHERE inventory <> (SELECT coalesce(sum(delta),0) FROM inventory_adjustments WHERE variant_id=v.id)` → 0);
check anon/authenticated denial; then release this app. The app requires 005.
**Rollback**: return to the PR #7 app and keep the additive schema. Note PR #7 edits
`products.inventory` directly, so stock changed while rolled back is not reflected in variants;
reconcile before re-releasing this version.

## API (all private routes: Bearer JWT, MFA aal2, active staff; writes need Admin/Editor)

- `GET /api/v3/products/:id` adds `option_names`, `featured_media_id`, `variants[]` (with `stock_status`), media `label`.
- `POST/PATCH /api/v3/products` accepts `option_names`, `variants:[{id?,option_values,sku,price_minor,active,media_id,inventory(new only)}]`, `featured_media_id`.
  The full variant list must be sent; existing stock cannot be changed through a save.
  Older clients sending top-level `price_minor/sku/inventory` still work for products without options;
  a changed `inventory` is recorded as a `correction` adjustment.
- `GET /api/v3/inventory?paged=true&q=&stock=in|low|out&product=` — variant stock list.
- `GET /api/v3/inventory/adjustments?variant=|product=&limit&offset` — history, newest first.
- `POST /api/v3/inventory/adjustments {variant_id, delta | set_to+expected, reason, note}`.
- `GET /api/v3/media?q=&format=jpg|png|webp&usage=unused|linked&status=ready` — picker filters.
- `GET /api/v3/media/previews?ids=1,2,…` (≤50) — batched five-minute private preview URLs.
- `POST /api/v3/uploads/sign {filename}` — stores a cleaned display label.

## Validation

Automated: API variant rules and rollbacks, SKU swaps and cross-product uniqueness, ledger
attribution, negative-stock and stale-count rejection, raw-SQL bypass rejection, grants/RLS,
Migration 005 preservation, picker filters/paging/batch previews, and DOM tests against the real
admin markup. Real PostgreSQL test: 6 concurrent "remove 2" requests on 5 units → exactly 2 succeed,
final stock 1; a product save running alongside stock adjustments neither deadlocks nor overwrites
stock. CI runs these against PostgreSQL 17.

Known limits: staff are shown by role and subject ID (the staff table has no names/emails yet).
Previews still use the authenticated original (no thumbnail transformation); assess Cloudinary
usage before large libraries. No reservations or checkout integration. Responsive appearance was
checked in a local headless browser with seeded sample data, not on the hosted Staging Preview.
