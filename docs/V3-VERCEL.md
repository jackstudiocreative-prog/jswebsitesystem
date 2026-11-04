# PR A: Vercel staging runtime

Supersedes the persistent-service hosting decision in V3-FOUNDATION.md. The 2026-11-04
Vercel/Supabase/Cloudinary Development Brief is the current architecture decision.
Choose native Vercel Node Functions plus static Web/Admin entry points. No framework rewrite is
needed to preserve the existing UI. The entry points are setup screens, NOT a completed staff UI.

## PR #2 review

Reviewed head 3d4a53881d3f93e1289ac7dc3774ff86aefcec5b, still OPEN. Reuse its migrations,
JWT verification, MFA aal2, staff roles, parameterized SQL, draft filtering and transaction audit.
CI passed for that head. No reason to duplicate them or reapply the V2 ZIP.

Deployment blockers remain: Supabase can grant anon/authenticated explicit table privileges;
revoking PUBLIC alone does not establish Supabase Data API isolation. Before any hosted migration,
PR B must provide explicit role grants/revokes or a private non-exposed schema and test least
privilege access. Other outstanding gates are provider login/reset flows, cloud upload verification,
staging restore and cross-device acceptance. PR #2 is a code foundation, not safe live deployment.

## Changes

- `src/handler.mjs`: existing service extracted unchanged except support for Vercel-parsed bodies;
  same authorization and bounded JSON parsing for streamed and parsed requests.
- `api/index.mjs`: Vercel default function export; no `listen`, writes or migrations at startup.
- `src/runtime.mjs`: warm-instance pool (max 2), bounded acquisition/query timeout, idle cleanup,
  verified TLS, explicit staging requirement, production API lockout, sanitized setup errors.
- `web/`, `admin/`: truthful setup pages using the existing brand stylesheet.
- `scripts/build.mjs`: copies only explicit public files; no config/secrets copied to public.
- `vercel.json`: API rewrites, noindex and response headers, 30-second function limit.

The original index.html, V2 UI and all product assets are untouched by this PR. Existing V3 local
server remains available for development. Long-running imports/backups/transforms belong in an
external worker or release job, never in an HTTP invocation.

## Account-owner setup (not performed)

1. Authorize a new company Vercel STAGING project linked to this repository, Root Directory `v3`.
   Enable **Include source files outside of the Root Directory**: shared catalogue code and the
   existing stylesheet are deliberately reused. Framework preset Other. Build `npm run build`,
   output `public`; install `npm ci`. Node 22.x. Do not connect the Shopify domain.
2. Use Preview deployments and Deployment Protection. This phase deliberately rejects
   VERCEL_ENV=production. Disable automatic production deployment for this staging-only project.
3. Set APP_ENV=staging; DATABASE_URL to the Supabase transaction-pooler URL with sslmode=verify-full
   and a least-privilege role. Use the pooler's documented endpoint; no named prepared statements.
   Add AUTH_ISSUER, AUTH_AUDIENCE, AUTH_JWKS_URL from the SAME staging identity project.
4. Keep MIGRATION_DATABASE_URL only in a release environment, not the runtime function. Do not run
   migrations during builds. PR B must resolve database isolation before applying hosted migrations.
5. Deploy only after authorization and review. Test /health, missing-token 401, real staff MFA,
   viewer denial, database restart persistence and preview routes. Missing configuration yields
   503, never demo fallback. No hosted URL exists yet.

Cloudinary account, cloud name, API key and API secret are needed in PR C; no Cloudinary integration
is claimed here. Supabase service-role secrets must never be exposed to the browser. The later auth
UI needs only SUPABASE_URL and its publishable key. Owners enter secrets in platform settings,
not chat, source files or PR bodies.

## Test evidence / limitations

V2: 8 passing. V3: 8 passing locally, 1 real PostgreSQL test deferred to CI. Static build passes.
CI additionally runs PostgreSQL 17 and the build. This is not a Vercel cloud deployment/build result.
No browser E2E or screenshot proof of a hosted staff app exists: the auth/UI stage is not built yet.

Rollback: revert this additive PR or roll the staging Vercel deployment back; no migration was
introduced and no V2 data was touched. Preserve PR #2. Never change production DNS or checkout.

Remaining sequence: PR B identity/database isolation and UI adapter; PR C verified Cloudinary
uploads/media; PR D product picker/order/alt and responsive delivery, then cloud and browser gates.

References: https://vercel.com/docs/functions/runtimes/node-js
https://supabase.com/docs/guides/database/connecting-to-postgres
