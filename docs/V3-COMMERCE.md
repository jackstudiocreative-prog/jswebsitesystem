# V3 Phase 4 — Checkout, eGHL payments and orders

## Branch and release boundary

Stacked on PR #9 (`update/v3-website-editor`). Merge order: **#6 → #7 → #8 → #9 → this PR**.
Not merged, not deployed, **Migration 007 not run**. main, Production, Shopify and the live site are
untouched. No real money: staging uses the mock gateway until eGHL sandbox credentials are set.

## Copied from the Shopify store

- **Payment gateway: eGHL Payment Gateway** — the gateway on all recent Shopify web orders
  (checked on the last 100 orders; others were staff "manual" orders).
- **Shipping** (Shopify delivery profiles, Malaysia, all states):

| Profile | Rate | Condition |
|---|---|---|
| General profile (default) | Free — "Gift Box, Gift Card, Name Engraving Available. Chat With Us for Details." | order of RM49 or more |
| General profile | RM5.00 (same name) | any order |
| Luggage Shipping Fees | RM26.90 "Luggage" | 1–50 kg |

As in Shopify, each profile in the bag uses its cheapest matching rate and the profiles are added together.
Products choose General or Luggage and a weight in the product editor. Luggage products need a weight;
without one, luggage shipping is unavailable (the same as Shopify's weight-based rate).

## Implemented (code + automated tests; not deployed)

- **Storefront** (staging, noindex): `/products/<handle>` (options, availability without exact stock),
  `/cart`, `/checkout` (Malaysian address, 16 states, 5-digit postcode), `/order/<number>`.
  Product grids on Website Editor pages link to product pages.
- **Checkout**: the server re-prices every line (client prices are ignored), applies shipping and
  creates the order. Stock is reserved atomically in the ledger (`sale`, linked to the order).
  A double click or retry returns the same order (idempotency key + customer-held access token).
  Unpaid orders release stock after 30 minutes (`sale_released`); orders with a bank-pending
  payment (e.g. FPX) are held up to 24 hours.
- **eGHL**: the browser posts a signed form to the eGHL hosted payment page (card data never
  touches this system). Only a **verified** server-to-server callback or browser return can change a
  payment: wrong signature, wrong merchant, unknown reference or wrong amount/currency are logged
  and ignored (amount mismatches are flagged for staff). Duplicate callbacks have no effect; a
  succeeded payment is never downgraded. If payment arrives after expiry the stock is taken again
  if available, otherwise the order is paid and **flagged for staff** (never negative stock).
  A second successful payment on a paid order is flagged for refund. Customers can retry a failed
  payment while the order is held (new reference `JSW…P2`).
- **Admin — Orders**: search/filter (awaiting payment, paid, to fulfil, needs attention, cancelled,
  expired), detail with items, totals, delivery, every payment attempt and gateway message, stock
  movements and refunds. Actions: mark fulfilled (+ tracking), cancel an unpaid order (releases
  stock), record a refund done in the eGHL merchant portal (optional one-time restock), resolve
  attention flags. Revision checks prevent two staff acting on stale data.
- **Admin — Customers**: built from paid orders (orders, spend, last order) until JS Membership is
  connected. **Settings**: read-only payment and shipping summary.
- **Dashboard**: paid orders, revenue (paid, net of refunds), awaiting payment, to fulfil, needs attention.

## Migration 007 (REVIEW REQUIRED; not run on hosted database)

New: `shipping_rates` (seeded with the three Shopify rules), `orders`, `order_lines`, `payments`,
`payment_events` (append-only gateway evidence; card fields and hashes are never stored), `refunds`,
`order_number_seq` (orders start at JSW50001, clear of Shopify's #js numbers).
Changed: `products` + `shipping_profile`, `weight_grams`; `inventory_adjustments` + `order_id` and the
reason/actor checks now allow system `sale` / `sale_released` entries (staff entries still need a staff actor).

Grants (`jackstudio_api` only): orders/payments SELECT/INSERT/UPDATE; order_lines, payment_events,
refunds SELECT/INSERT (append-only); shipping_rates SELECT (read-only at runtime); sequences.
No DELETE anywhere. RLS + `server_access`; anon/authenticated revoked.

## Configuration (server environment only — never commit values)

`PUBLIC_BASE_URL` (https origin for return/callback URLs), `PAYMENT_PROVIDER` (`eghl` or `mock`),
`EGHL_SERVICE_ID`, `EGHL_PASSWORD`, `EGHL_PAYMENT_URL` (eGHL test URL for sandbox),
`MOCK_PAYMENT_SECRET` (≥32 chars; mock is refused unless `APP_ENV=staging`).
Without valid settings checkout returns 503 "Checkout is not configured".

## Before eGHL sandbox (action required)

1. Request eGHL **sandbox** credentials (Service ID, merchant password, test payment URL) and the
   merchant integration document. Put them only in Vercel Staging environment variables.
2. **Confirm the response hash field order** against the eGHL document (`src/payments.mjs`
   `responseHash` / `responseHash2`). The request hash matches eGHL's published SDK usage.
3. Register the callback URL `https://<staging>/api/v3/payments/eghl/callback` if eGHL requires it.
4. Test in sandbox: success, failure, cancel, FPX pending, duplicate callback, amount tamper, late payment.

## Validation

Automated (52 tests; real PostgreSQL in CI): shipping rules, server pricing, idempotent checkout,
oversell rejection, tampered/duplicate/mismatched/failed/late callbacks, retry, expiry release,
staff roles and actions, refunds with restock, customers, dashboard, append-only tables, grants.
Real PostgreSQL: 10 simultaneous checkouts for 3 units → exactly 3 orders; 5 simultaneous duplicate
callbacks → paid once; checkout alongside a product save → no deadlock. Browser run with seeded data:
product → bag → checkout → mock eGHL → confirmed order → staff order detail (desktop and mobile).

Known limits: eGHL refunds are recorded, not sent (eGHL's refund API needs their private SDK);
no taxes (prices as in the catalogue); no order emails (no SMTP yet); public pages show image
placeholders (originals private); guest checkout only until the JS Membership contract is available;
checkout has no bot/rate protection beyond reservation expiry — add before public launch.
