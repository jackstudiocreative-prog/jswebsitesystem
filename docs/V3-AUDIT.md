# V3 corrective audit — 2026-11-05

Base: `update/v3-quality` at `b5cfec2befe59cd6fd2d2455884e8877b6962bf7`.
Repair branch: `fix/v3-audit-hardening`; PR base must remain `update/v3-quality`.
Read the complete V3-SYSTEM-OVERVIEW, V3-QUALITY, migrations 001–008 and the API,
commerce, inventory, catalogue, pages, media, auth, runtime, browser and CI paths.
Existing UI, data model and features are retained. No migration SQL was changed.
This is a source/test audit, not certification of hosted infrastructure or eGHL compatibility.

## Confirmed issues repaired

| Issue | Repair and main files |
|---|---|
| Vercel parsed JSON became URLSearchParams, losing nested checkout data | Content-type-aware body normalization; one reader for staff/public endpoints; preserve objects, strings, Buffers and split UTF-8 streams; 64 KiB limit in every path. `v3/src/handler.mjs` |
| Ambiguous gateway forms | Require form content type, reject duplicate/nested/array fields before verification. `handler.mjs`, `payments.mjs` |
| Expiry depended on visitor/staff requests | Independent authenticated maintenance endpoint; remove incidental sweeps. `maintenance.mjs`, `commerce.mjs` |
| Duplicate pending callbacks could extend stock holds forever | Bound the bank-pending exception to 24 hours from payment creation, rather than last callback time. `commerce.mjs` |
| Multi-order expiry batches could acquire product locks in opposite orders | Lock due orders with SKIP LOCKED, then all affected products in ascending global order. `commerce.mjs` |
| Concurrent identical checkout could return a uniqueness conflict; simultaneous orders could bypass email cap | Transaction advisory locks for checkout key and normalized email; count all still-held pending orders, including bank-pending. `commerce.mjs` |
| Checkout priced before waiting for staff's product lock | Lock products before re-reading price, sellability and shipping attributes. `commerce.mjs` |
| Late successful payment could partially reserve lines; subsequent refund could create stock never reserved | Re-reserve the entire order only when all lines are available; flag shortages; block fulfilment while flagged; refund restocks net actual order deductions (also handles older partial reservations). `commerce.mjs` |
| Callback event blocklist could persist newly named card/token/PII fields | Explicit minimal field allowlist; do not retain signatures, auth codes, messages or unknown fields in event payloads. `commerce.mjs` |
| HashValue2 signed order reference was not checked | Verify it matches the payment's stored order; legacy HashValue does not authenticate OrderNumber and is not trusted for this binding. `payments.mjs`, `commerce.mjs` |
| Saving a draft URL changed the live route and sitemap before publishing | Public route and sitemap use the published revision; route ownership checks serialize; redirects change only on publish. `pages.mjs`, `seo.mjs` |
| UI still said reservations were missing; checkout implied verified eGHL | Correct the catalogue and checkout copy; browser test labels identify the mock gateway. `admin/catalog-ui.mjs`, `web/shop.mjs`, `e2e/storefront.spec.mjs` |
| V2 workflow did not run on a PR targeting the requested base | Add `update/v3-quality` to its existing PR base filter. `.github/workflows/ci.yml` |
| E2E bundling used a URL pathname as a Windows filesystem path | Use fileURLToPath. `scripts/e2e-server.mjs` |

Regression tests: `v3/tests/commerce.test.mjs`, `maintenance.test.mjs`,
`postgres-commerce.test.mjs`, `website-editor.test.mjs`.
The real PostgreSQL suite covers overselling, same-key concurrency, the email cap,
price changes while checkout waits for a lock, duplicate callbacks and concurrent expiry workers.

## Expiry operation: code ready, scheduling NOT enabled

`POST /api/v3/maintenance/expire-orders`, with `Authorization: Bearer <MAINTENANCE_SECRET>`.
The server-only token must contain at least 32 random characters. Missing/short configuration
returns 503; wrong/missing authorization returns 401 before any database connection.
GET is refused. No secrets in query strings, request logs, repository, browser or responses.
The normal application uses the existing restricted runtime database role; no operator connection
or new database grants are needed. The scheduler needs only this endpoint token.

One invocation processes at most 50 eligible orders in a transaction, releases inventory through
the existing ledger, removes rate counters older than one day, and returns:
`{expired, more, due, oldest_due_at}`. Failures roll back; retries and overlapping workers are safe.
`due` is a point-in-time snapshot that may include work another worker has locked, so monitor trends
rather than treating one response as a globally consistent queue metric. No payment or customer data is returned.

Required operational design, to implement only after separate Staging approval:

1. Use a managed external scheduler with minute-level frequency and retries against a stable,
   explicitly selected **Staging** hostname. Do not use GitHub Actions as a precise minute timer.
   Do not add Vercel Cron here: [Vercel Cron targets the Production deployment](https://vercel.com/docs/cron-jobs),
   while this project deliberately refuses Production deployments and builds.
2. Store its token in the scheduler and Staging secret stores; rotate it there. If deployment
   protection is enabled, configure the scheduler's approved access mechanism separately.
3. Send one POST every minute, with a client timeout below the function's 30-second budget.
   On HTTP/network failure retry with bounded exponential backoff. Never follow redirects to
   another host. On `more=true`, run another batch immediately with bounded drain attempts,
   then let the next minute continue. Measure worst-case 50-line orders; reduce the batch if needed.
4. Record successful invocation timestamps, duration, expired count and due age outside the app.
   Alert if there is no successful run for 3 minutes, eligible backlog age exceeds 5 minutes,
   or backlog grows across runs. A second independent monitor must detect a silent scheduler outage.
5. Validate using disposable Staging orders: reserve stock, close all browsers, wait beyond
   30 minutes, verify automatic release and ledger balance. Test scheduler outage/recovery,
   failed transactions, duplicate jobs and simultaneous callbacks before enabling checkout publicly.

Reservation duration is 30 minutes, with release on the next successful sweep (normally within
about one additional minute plus processing time); it is not a hard real-time 30-minute guarantee.
Bank-pending payments are explicitly held for at most 24 hours from that attempt's creation.
Provider query/reconciliation before releasing bank-pending payments remains a future requirement;
late success is handled by the stock/attention logic. Scheduling has NOT been configured or invoked
against a hosted environment in this audit. Until deployment and scheduler acceptance, automatic
hosted release is unverified and checkout is not ready for public operation.

## eGHL: request AND response protocol unverified

The existing SHA-256 request and HashValue/HashValue2 response functions are retained as
**candidate implementations**. We have neither the merchant's official integration document
nor Sandbox evidence. Local hash tests and mock E2E are internally consistent fixtures, not
independent evidence of the eGHL protocol. Earlier statements that the request hash was
"confirmed" must not be treated as acceptance.

The adapter now also requires `APP_ENV=staging` and `EGHL_SANDBOX_ENABLED=true` before eGHL
can be used. It stays disabled by default; mock remains Staging-only. This opt-in is not proof
that a configured URL/account is Sandbox: the operator must independently confirm both.
No eGHL network request, merchant login, real credential or real payment was used here.

Before accepting the integration, obtain the applicable merchant document/version through the
merchant's approved channel (no secrets in chat), then independently confirm:

- Complete request field order, optional empty fields (approval/unapproval URLs, callback URL,
  card/token fields when absent), UTF-8/normalization and amount formatting; official sample hashes.
- HashValue versus HashValue2 field order, optional parameters, algorithm/version and downgrade
  policy; whether an unsigned legacy OrderNumber should be ignored or legacy signatures refused.
- Transaction type, status mapping, transaction ID/reference uniqueness, callback acknowledgement
  body, retry cadence, browser-return authority and server-to-server query reconciliation.
- Hosted-payment URL and callback registration for the actual **Sandbox** account.
- Sandbox FPX/card/e-wallet success, decline/cancel, pending then final result, duplicates,
  reordered/late callbacks, wrong merchant, wrong order/amount/currency and signature tampering.

Existing checks bind the configured merchant, payment reference/provider, amount and MYR currency;
success cannot be downgraded, duplicate success does not re-deduct stock, a second successful
payment is flagged, and events are append-only. None of this establishes provider compatibility.
Refunds are staff records of portal refunds, not gateway refund execution. Pending-payment
query/reconciliation and provider-specific settlement evidence remain unfinished.

## Cloudinary public delivery design (NOT enabled)

Confirmed: `media.mjs` uploads/inspects `authenticated` originals and gives staff five-minute
private download URLs; the storefront product page always renders a placeholder. Public page
data has image IDs but no delivery manifest; `web/page.mjs` calls the renderer with an empty
media map. Do not expose the staff preview endpoint or private download URLs to public caches.

Recommended next implementation, preserving the private library:

1. Create separate, deliberately public, metadata-stripped catalogue derivatives in a dedicated
   Cloudinary folder/product environment. Keep authenticated originals unchanged. Promotion must
   require an active product in an active collection or a visible image in a published revision;
   draft/hidden/unlinked library assets never qualify merely because their ID exists.
2. Generate only fixed widths (e.g. 320/640/960/1440), bounded crop/quality and approved formats.
   Enable strict transformations, sign final transformation URLs server-side or use explicitly
   approved/eager variants. No arbitrary public_id, fetch URL, transformation or remote proxy input.
   [Cloudinary access-control documentation](https://cloudinary.com/documentation/control_access_to_media)
   distinguishes authenticated delivery from public delivery and explains strict transformations.
3. Persist a verified public derivative manifest keyed by original asset ID/version and publication
   state in a separately reviewed additive migration. Store only the immutable public URLs,
   dimensions, format and width; never any secret or private preview signature in public responses.
4. Return only the publication-authorized manifest on product/page/grid APIs. Render gallery and
   variant images with `srcset`, `sizes`, width/height, real alt text and lazy loading below the fold;
   prioritize only the first above-the-fold image. Cache immutable versioned images; use short
   cache TTLs for publication manifests. Restrict CSP to the chosen Cloudinary host.
5. Revoke promotion on archive/unpublish/unlink and request CDN invalidation. Already public files
   may have been cached or saved; this design is for public product imagery, never sensitive media.
   Do not claim an ordinary signed delivery URL expires automatically; signatures alone are not TTLs.
6. Test draft/unpublished/hidden/foreign IDs, guessed IDs, transformation tampering, responsive
   rendering, failed-image fallbacks and archive cache invalidation in a disposable Cloudinary setup.

## Database permissions and other remaining work

Migrations 001–008 were read in full and left byte-for-byte unchanged. They enable RLS and
revoke table access from PUBLIC/anon/authenticated; the non-login `jackstudio_api` role has
server-access policies and explicit catalogue/order permissions. Staff has SELECT only; audit,
inventory ledger, order lines, payment events, refunds and page revisions are append-only.
Runtime cannot delete orders, products, variants or outbox rows. Tests cover those boundaries.
The API additionally checks active staff, MFA aal2 and viewer/editor/admin permissions.

Hosted acceptance remains necessary: confirm runtime login is not superuser/BYPASSRLS/table
owner, only the intended login has membership in `jackstudio_api`, anon/authenticated cannot
assume it, and hosted default privileges expose neither new tables nor sequences/functions.
RLS does not protect data when the runtime uses an owner/BYPASSRLS account. No hosted role,
grant, customer, payment or configuration was inspected or changed here.

Unfinished or limited behavior, not represented as Shopify parity:

- Actual email delivery/retries/provider setup (only transactional outbox is implemented).
- JS Membership/customer accounts, editable settings, discounts/promotions, taxes, shipping
  integrations, item-level partial returns, automated gateway refunds and settlement reconciliation.
- Public catalogue/collection navigation and home routing: `/` remains a Staging setup page;
  templates may link to `/collections`, which has no V3 route. Root catalogue/page responses still
  use the legacy `checkoutAvailable:false` indicator; product detail supports checkout. These
  contracts/navigation need a dedicated storefront completion pass, not just changing a boolean.
- Public product/gallery/page image delivery described above; no Cloudinary settings changed.
- Hosted invitation/MFA/email checks, real mobile Safari/Chrome checks, load testing and scheduler
  outage monitoring. Browser E2E uses fixed test identity, PGlite and mock payments.
- SEO still uses client-rendered HTML, metadata and redirect handling; server-rendered metadata,
  true HTTP redirect/404 status behavior and product structured data need a separate SEO pass.
- Existing axe brand-button contrast exception remains explicitly documented in V3-QUALITY.md.
- IP rate limits depend on a trusted proxy replacing `x-forwarded-for`; confirm hosting behavior
  and edge throttling before public launch. Rate windows are fixed, not a complete bot defense.

## Validation and safe merge sequence

Local V2 smoke tests, V3 unit/integration tests and build are run on synthetic/disposable data.
The three real PostgreSQL tests require `TEST_DATABASE_URL`; local runs skip them if no disposable
server is available. GitHub V3 CI uses its isolated PostgreSQL 17 service, never Supabase.
Playwright desktop/mobile uses a loopback-only test server; it does not test hosted auth or eGHL.
Consult the PR's final CI checks for exact head SHA and outcomes; do not count skipped tests as passed.

1. Review/merge only this corrective PR into `update/v3-quality` after its tests pass; this does
   not merge #6–#11. Retain payment/image/scheduler blockers in release acceptance.
2. Later, separately approved staging integration follows #6 → #7 → #8 → #9 → #10 → #11, preserving
   the fixes in #11's quality branch. Retarget/rebase each stacked PR carefully and rerun CI; never
   merge the cumulative quality branch directly to staging as a substitute for stack review.
3. Before each app version that requires schema changes, an authorized operator must separately
   review backups, rollback/forward recovery and matching migrations 004 → 005 → 006 → 007 → 008
   on Staging. This audit does not run them on Supabase or authorize deployment. Staging merges
   can trigger existing Preview automation, so control that separately before merging.
4. Accept hosted auth/roles, image publication, real Sandbox protocol and scheduler/no-traffic
   expiry; then address remaining storefront/email gaps before any public launch decision.

No PR was merged, no Vercel deployment or Supabase migration was performed, and main,
Production and Shopify were not modified. No real customer/payment data or secret was requested.
