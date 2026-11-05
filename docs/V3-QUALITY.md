# V3 Phase 5 — Abuse protection, SEO, order emails, browser E2E and security headers

See the later [corrective audit](V3-AUDIT.md) for repaired request parsing, concurrent checkout,
independent expiry, published URL isolation, protocol uncertainty and remaining release blockers.

## Branch and release boundary

Stacked on PR #10 (`update/v3-commerce`). Merge order: **#6 → #7 → #8 → #9 → #10 → this PR**.
Not merged, not deployed, **Migration 008 not run**. main, Production, Shopify and the live site untouched.

## Implemented

- **Rate limits** shared across serverless instances (PostgreSQL counters; only SHA-256 hashes of
  IP/email are stored): checkout 10 per 10 min per client and 5 per hour per email, payment retries
  10 per 10 min, order status 60/min, bag pricing 120/min, staging mock gateway 30/min. Counted
  outside the request transaction, so rejected attempts still count. eGHL callbacks are never limited.
- **Checkout honeypot** field (hidden from people and assistive technology) and **max 3 unpaid
  orders per email**, so nobody can hold the catalogue's stock with unpaid orders.
- **SEO**: `/sitemap.xml` (published pages + sellable products), `/robots.txt` (staging: disallow all;
  with `SITE_INDEXING=on`: allow, but never admin/api/cart/checkout/order/pay), canonical links and
  Open Graph tags on pages and products. Staging also keeps `X-Robots-Tag: noindex`.
- **Caching**: published pages, product data, shipping rates, sitemap: `public, max-age=30–300`.
  Everything private stays `no-store` (checked in tests).
- **Order emails (outbox)**: confirmation, shipped (with tracking) and refund emails are queued in the
  same transaction as the order change (duplicates impossible, failed changes queue nothing). Visible on
  the order and the dashboard ("Emails waiting to send"). **Sending is not enabled**: choose an email
  provider (SMTP) and a sender will deliver queued messages.
- **Security headers**: Content-Security-Policy for the storefront (scripts/styles/connections only from
  this site; images from this site and Cloudinary; forms may post to the payment page) and for the admin
  (adds Supabase and Cloudinary), plus Permissions-Policy. Verified by the browser suite.
- **Browser E2E** (Playwright, desktop + mobile, in CI): customer buys a variant, declines then retries
  payment, luggage shipping; staff create a product, adjust stock, build/preview/publish a page, fulfil a
  paid order (email queued), viewer is read-only. Every page is checked for CSP violations and JS errors
  and scanned with **axe (WCAG 2.1 A/AA)**.
- **Accessibility fixes from axe**: eyebrow labels and shipping-rate notes darkened slightly to pass
  contrast (same hue).

## Decision needed: brand button contrast

The existing V2 storefront button (white text on **#a97845**) is **3.85:1**; WCAG AA needs 4.5:1 for
text this size. It was not changed because it is the brand colour. Options: keep it (documented
exception), use **#946535** (5.03:1, slightly deeper brown) for buttons only, or make button text
larger/bolder. The E2E accessibility check sets aside only this one finding until you decide.

## Migration 008 (REVIEW REQUIRED; not run on hosted database)

`rate_limits` (hashed key + window; DELETE allowed for clean-up), `email_outbox` (no DELETE).
RLS + `server_access`; anon/authenticated revoked. Additive only.

## E2E harness (test-only)

`v3/scripts/e2e-server.mjs` refuses to start unless `E2E_HARNESS=1`, binds to 127.0.0.1, and serves
the real build with the real `vercel.json` headers/rewrites on the real API, using in-memory
PostgreSQL, a fixed test identity and the mock gateway. It is not part of the build or deployment.
The staff workspace in E2E skips Supabase sign-in (sign-in, invitation and MFA have their own DOM tests).
Run locally: `npm run e2e` (or `CHROME_PATH=/path/to/chrome npm run e2e`).

## Validation

Unit/integration: 58 tests (real PostgreSQL in CI). Browser: 10 E2E tests (desktop and mobile).
