# Staff Auth and Cloudinary staging code

PR #2, #3 and #4 are merged. This guide describes their staging foundation. No hosted SQL, deployment, Shopify operation,
DNS change, Cloudinary upload or payment configuration has been performed by this work.
Project reference supplied by owner: `cquhddsrhnacbkvszitl` (Singapore).

## Implemented

- Forward migrations 002/003: RLS on application tables, explicit anon/authenticated revocation,
  non-login `jackstudio_api` role with limited grants. Staff and audit records cannot be modified
  by that runtime role. Existing columns/assets remain intact. Media metadata and upload intents added.
- Staff UI: Supabase password login, TOTP enrollment/challenge, logout, password reset/recovery.
  Tokens are memory-only; only the PKCE verifier is held in sessionStorage. Refreshing the page
  normally requires sign-in again. Recovery links must open in the initiating browser tab/session.
- Server checks JWT and MFA then database staff allowlist on every private request. A session
  endpoint returns subject/role, never credentials. Viewers cannot request or finalize uploads.
- Signed authenticated-image uploads: random non-overwritable IDs, 10-per-minute database-backed
  actor limit, 10-minute finalize deadline, owner binding and idempotent finalize. Actual metadata is
  fetched using server credentials from Cloudinary, not accepted from client response fields.
- Metadata-only Media Library and shared Products/Collections read view. This is not the complete
  V2 Dashboard migration, product CRUD UI, image picker, ordering or public image delivery.

## Configuration guide — prepare values; do not deploy or run SQL yet

In Vercel Preview environment for the isolated Staging project, prepare:

| Variable | Value/source | Exposure |
|---|---|---|
| APP_ENV | staging | server |
| SUPABASE_URL | https://cquhddsrhnacbkvszitl.supabase.co | public build |
| SUPABASE_PUBLISHABLE_KEY | Supabase project's `sb_publishable_...` key | public build |
| AUTH_ISSUER | https://cquhddsrhnacbkvszitl.supabase.co/auth/v1 | server |
| AUTH_AUDIENCE | authenticated | server |
| AUTH_JWKS_URL | https://cquhddsrhnacbkvszitl.supabase.co/auth/v1/.well-known/jwks.json | server |
| DATABASE_URL | Supabase transaction-pooler URL for dedicated runtime login, sslmode=verify-full | secret |
| DATABASE_CA_CERT | Complete trusted Supabase PEM CA certificate text, not a Windows file path | server only |
| CLOUDINARY_CLOUD_NAME | API credentials page for Test environment, not console URL identifier | server/public signature response |
| CLOUDINARY_API_KEY | same Test environment | server/public signature response |
| CLOUDINARY_API_SECRET | same Test environment | server secret only |
| CLOUDINARY_UPLOAD_PRESET | reviewed signed-only Test preset name | server |

`MIGRATION_DATABASE_URL` belongs to a protected release environment with owner permissions,
not browser bundles or normal Vercel runtime. Do not paste any secret into chat or commit it.
Build emits only SUPABASE_URL and the publishable key. Never provide service-role keys there.
Root Directory remains `v3`, include source files outside Root Directory, Node 22.x,
build `npm run build`, output `public`. Current production-environment API guard remains enabled.

See [Vercel TLS and Preview policy](V3-VERCEL-TLS.md) for required CA configuration and branch guards.
The owner reports migrations 001–003 and restricted-login tests already completed in Staging;
do not repeat the database setup below on that existing project.

## Later authorized database/auth setup

1. Review SQL 001→002→003, take a backup, then run `npm run migrate` ONLY after approval to
   modify this staging database. Check the runtime role is not owner, superuser, BYPASSRLS or
   a member of privileged roles. It inherits only `jackstudio_api`; never use postgres as DATABASE_URL.
2. Create a dedicated LOGIN role with an independently generated secret through protected admin
   tooling, grant membership in `jackstudio_api`, use its pooled connection URL. The migrations
   intentionally do not create a login password. Do not give this role to anon/authenticated/authenticator.
3. Supabase staff registration: disable public sign-up; invite employees from the Supabase console.
   Use verified staff UUID subjects in `staff` with the intended role. Invitation email setup and
   automatic allowlist provisioning are not implemented. Use provider recovery to set/reset password.
4. Configure asymmetric signing keys, TOTP and email delivery; set Site URL and exact `/admin`
   redirect URL to the eventual Staging Preview hostname. Do not allow production domains or wildcards.
5. Test actual invitation/password recovery, MFA enrollment, verified MFA, viewer denial,
   disabled staff and logout. Password reset does not instantly revoke all already-issued access
   tokens: use short JWT expiry and disable staff during incidents, plus provider session revocation.

## Cloudinary preset and quarantine

Configure a signed-only Test upload preset: image resource, authenticated delivery, only
JPEG/PNG/WebP, maximum file size 10 MB, no destructive incoming/eager transformations, no overwrite.
Use dynamic folder support for `asset_folder=jackstudio-websitesystem/products`. The other prepared
folders are not used by this first product uploader. Verify preset constraints with actual uploads
before opening staff access. Never create an unsigned public-upload preset for this flow.

Cloudinary signatures have a native one-hour validity; the app's 10-minute deadline limits DB
acceptance, not Cloudinary's own upload window. Random public IDs plus overwrite=false limit replay.
All masters are `authenticated`; failed, oversized or expired assets remain private and are not
added to media. Cloudinary's image decoder plus server-fetched format/dimensions enforce acceptance:
<=10 MB, <=10000 per dimension, <=40 million pixels, approved raster formats. No client MIME trust.

No automatic deletion job is shipped. Before real use, schedule an authorized operator/worker to
review unfinalized intents older than one hour and reconcile private orphan assets; do not blindly
delete folders. Network failure after upload may leave an orphan. Retry via the existing finalize
API with the same intent ID within 10 minutes; frontend resume UI is not yet implemented.
Never publish the private masters manually to work around missing preview functionality.

## Verification and release gates

Local tests use PostgreSQL-WASM and provider doubles; they prove SQL/authorization/asset acceptance,
not a real account connection. CI uses PostgreSQL 17 to verify real RLS and role grants. Browser
SDK flows are built but real hosted MFA/reset email E2E remains a staging gate. No screenshot or
cloud success is implied. Run `npm test` in both `v3` and `jackstudio-admin-mvp`; run `npm run build`
in `v3`. Preserve successful CI links in PR.

Before deployment: validate isolation via anon/authenticated and dedicated runtime login; prove
admin A/B catalogue consistency and drafts hidden from storefront; exercise signed uploads with
valid, corrupt, unsupported, oversized and replayed files; rehearse backup/restore. Public image
delivery, picker/sort/alt, responsive sizes, automatic cleanup, complete Dashboard adapter and
browser E2E are remaining work. Checkout/payment/member migration remain disabled/unimplemented.

Rollback code to PR #3 if necessary, retain additive migrations and private assets. Do not roll
back the security migration by granting browser roles access. Restore any damaged data to an
isolated database first; no destructive down migration is provided.

## MFA QR correction

The SDK-provided SVG data URL is validated and assigned unchanged to the image src. A second
prefix is never added. Tests cover raw/percent-encoded SDK URLs, malformed/nested URLs, enrollment
errors, challenge and verification sequencing, aal2 enforcement, existing factors, recovery and
logout cleanup. A DOM-event harness executes the actual admin module with a mocked provider to
check the displayed src and workspace access. This is not a live browser/Supabase MFA or email test.
Hosted authenticator scanning and same-tab PKCE recovery remain first-Staging acceptance checks.
