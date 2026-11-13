# Staff Auth and Cloudinary staging code

PR #2, #3 and #4 are merged. This guide describes their staging foundation. No hosted SQL, deployment, Shopify operation,
DNS change, Cloudinary upload or payment configuration has been performed by this work.
Project reference supplied by owner: `cquhddsrhnacbkvszitl` (Singapore).

## Implemented

- Forward migrations 002/003: RLS on application tables, explicit anon/authenticated revocation,
  non-login `jackstudio_api` role with limited grants. Staff and audit records cannot be modified
  by that runtime role. Existing columns/assets remain intact. Media metadata and upload intents added.
- Staff UI: Supabase password login, TOTP enrollment/challenge, logout, password reset/recovery.
  Sessions, access and refresh tokens are memory-only (per tab). Only Supabase PKCE verifier entries
  (`sb-<ref>-auth-token[-flow-<id>|-flows]-code-verifier`) are kept in localStorage, wrapped with a
  24-hour expiry, so a recovery email can be opened in a new tab of the same browser profile.
  Refreshing the page normally requires sign-in again. See "Password recovery" below.
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

Supabase Auth generates the TOTP QR with SVGo, so `totp.qr_code` is SVG markup that starts with
an XML declaration and a comment before `<svg>`; supabase-js prefixes it, unencoded, with
`data:image/svg+xml;utf-8,`. The earlier validator only accepted markup beginning with `<svg>`,
so it threw after Supabase had already created the factor: no QR was shown, the factor ID was
lost, the factor stayed `unverified`, and every retry failed with "A factor with the friendly name
"Jack Studio Staff" for this user already exists".

Now (`admin/auth-client.mjs`, `admin/app.mjs`):
- The QR is read from `data.totp.qr_code`, the SVG is validated (XML declaration and comments
  allowed) and re-encoded once as `data:image/svg+xml;charset=utf-8,<percent-encoded SVG>` for the
  `<img>` src, so characters such as `#` or `%` cannot break it. No second prefix is added.
- The new factor ID is kept in the page's enrollment state and used for challenge/verify. A
  wrong code keeps the QR on screen; success clears the state.
- Only one enrollment request runs at a time; clicking "Set up authenticator" again while a
  setup is pending shows the same QR instead of creating another factor.
- Before enrolling, abandoned unverified TOTP factors are removed (supabase-js lists them only
  in `listFactors().all`; `.totp` holds verified factors), so the friendly name cannot conflict.
  Verified factors are never removed; with one present, enrollment is refused.
- If the QR cannot be rendered, the just-created factor is removed instead of left behind.

Tests use the real SVGo-shaped response; they fail against the previous code. Unit and DOM-harness
tests plus a headless-Chrome render of the generated data URL pass. This is still not a live
Supabase MFA test: scanning with an authenticator app on Staging remains an acceptance check.

## Password recovery (PKCE, cross-tab)

- "Send password reset email" creates a PKCE verifier. The verifier is stored in localStorage of the
  same browser profile (never sessions or tokens), so the email link works in a new tab or window of
  that browser. Another browser, profile or device cannot complete it; request a new email there.
- Only the recovering tab opens the "Choose a new password" form. Other open admin tabs receive
  Supabase's relayed event and show "Password recovery is open in another tab." without a session.
- After the new password is saved, all sessions are revoked (global sign-out) and every stored
  verifier entry is cleared. Unused verifiers expire after 24 hours; a blocked or full localStorage
  falls back to this tab's memory (then the email must be opened from this tab's session only).
- **Open the newest reset email.** With the default SDK configuration the email carries no flow id,
  so the browser uses its most recent verifier; an older email fails closed and spends its one-time
  code. Optional: enabling the SDK's experimental `appendPkceFlowIdToRedirects` makes every email
  work independently (the admin already accepts `sb_flow_id`), but first change the Supabase Auth
  Redirect URLs allow-list to tolerate the extra query parameter (e.g. `https://<staging>/admin**`);
  with an exact `/admin` entry Supabase would fall back to the Site URL and recovery would break.
