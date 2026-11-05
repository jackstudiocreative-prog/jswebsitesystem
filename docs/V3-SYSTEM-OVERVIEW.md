# Jack Studio Independent E-commerce System V3 — Overview and acceptance checklist

Latest corrective audit: [V3-AUDIT.md](V3-AUDIT.md). It supersedes earlier expiry and eGHL
readiness claims: scheduled cleanup must be separately activated, both payment hash formats
remain unverified, and public image delivery is still a release blocker.

All V3 phases are built as stacked pull requests. Nothing is merged or deployed, and no V3 migration
has been run on the hosted database. main, Production, Shopify and the live website are untouched.

## Pull requests (merge in this order, each into `staging`)

| PR | Content | Migration |
|---|---|---|
| #6 | Staff invitation and first password | — |
| #7 | Admin dashboard, products, collections, media | 004 |
| #8 | Variants, inventory ledger, media picker | 005 |
| #9 | Website Editor (sections, preview, publish, versions) | 006 |
| #10 | Checkout, eGHL payments, orders, Shopify shipping rules | 007 |
| #11 | Abuse protection, SEO, order email outbox, E2E, CSP | 008 |

After each merge, retarget the next PR to `staging`. Merging into `staging` can trigger a Vercel Preview.
**Apply the matching migration before the app version that needs it** (operator account, never runtime).

## Architecture

Vercel Functions (API) + static admin and storefront · Supabase PostgreSQL (staff auth with MFA, data with
RLS, API role without BYPASSRLS) · Cloudinary (private, signed media) · eGHL hosted payment page.

## Environment variables (Vercel Staging; values never in the repo)

Existing: `DATABASE_URL`, `DATABASE_CA_CERT`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, `APP_ENV=staging`,
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CLOUDINARY_*`.
New: `PUBLIC_BASE_URL`, `PAYMENT_PROVIDER` (`mock` until sandbox, then `eghl`), `MOCK_PAYMENT_SECRET`,
`EGHL_SERVICE_ID`, `EGHL_PASSWORD`, `EGHL_PAYMENT_URL`, optional `SITE_INDEXING` (leave off on staging).

## Open decisions and inputs

1. **eGHL sandbox** credentials + merchant document; confirm the response-hash field order (`src/payments.mjs`).
2. **Email provider (SMTP)** to send the queued order emails.
3. **JS Membership** integration contract (customer accounts; today: guest checkout).
4. **Brand button contrast** (#a97845 is 3.85:1; see V3-QUALITY.md).
5. **Public image delivery** (product/page images are private originals; public pages show placeholders).

## Acceptance checklist (hosted Staging)

Staff and security
- [ ] Invite a staff member, set first password, enrol MFA; viewer/editor/admin permissions behave as expected
- [ ] Signed-out and non-MFA requests are refused; anon/authenticated roles cannot read any table

Catalogue
- [ ] Existing products keep SKU, price, stock and images after 004/005
- [ ] Create a product with Color/Size variants, featured image and gallery; deactivate a variant
- [ ] Adjust stock with each reason; history shows staff and time; counted quantity rejects stale counts

Website
- [ ] Create pages from templates, add/hide/duplicate/reorder sections, preview desktop/tablet/mobile
- [ ] Publish, edit, restore an older version, publish again; change a URL and check the old URL redirects

Checkout and payments (eGHL sandbox)
- [ ] Shipping: RM5 under RM49, free from RM49, luggage RM26.90 (1–50 kg), mixed bag adds both
- [ ] Pay successfully (FPX, card, e-wallet); order becomes Paid once; stock deducted once
- [ ] Decline/cancel, retry; bank-pending (FPX) resolves later; unpaid order expires after 30 min and releases stock
- [ ] Order status page, staff fulfilment with tracking, refund recorded (eGHL portal) with restock
- [ ] Rate limits and the 3-unpaid-orders cap behave as described

Quality
- [ ] Browser check on real phones (iOS Safari, Android Chrome) and desktop browsers
- [ ] CSP shows no blocked requests on the hosted domain (Supabase, Cloudinary, eGHL)
- [ ] sitemap.xml lists published content; robots.txt blocks indexing on staging
