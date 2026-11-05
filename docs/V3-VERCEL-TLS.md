# Vercel PostgreSQL CA trust and Preview-only policy

No database connection, migration, hosted deployment or Production setting change is performed
by this PR. User reports successful restricted-role/RLS/TLS tests from Windows; that does not
prove Vercel can load the same CA. A local Windows prod-ca-2021.crt path cannot work in Vercel.

## Server TLS configuration

In Vercel Project → Settings → Environment Variables, Preview only (optionally scoped to staging):

- `DATABASE_URL`: existing restricted account pooler URL ending `?sslmode=verify-full`.
  Remove `sslrootcert=C:\...` and other query parameters. Do not replace the account with postgres.
- `DATABASE_CA_CERT`: paste the complete PEM certificate text, including BEGIN/END CERTIFICATE,
  from the trusted Supabase CA file already used successfully. Actual newlines or literal `\n`
  separators are accepted. A PEM CA bundle is supported. Never paste a private key or password here.

Only the server reads this variable. The frontend build still emits only publishable Auth config.
No runtime disk path, public downloads or fallback to unverified TLS are used. Missing/malformed
CA fails closed. Obtain/rotate CA via the authenticated provider dashboard, not arbitrary URLs.

`pg` replaces explicit `ssl` options if a connection string contains SSL options. The adapter
therefore validates the original URL must say exactly verify-full, rejects other query overrides,
then passes separate host/port/user/password/database fields and explicit `ssl` to pg. The saved
environment URL remains verify-full; equivalent semantics are enforced by rejectUnauthorized=true,
Node tls.checkServerIdentity and TLS >=1.2. There is no connectionString for pg to reparse/override.
verify-ca is no longer accepted because it does not express hostname verification. Never set
NODE_TLS_REJECT_UNAUTHORIZED=0 or rejectUnauthorized=false.

No actual Supabase credentials are needed for tests. Tests use temporary local certificates and
real Node TLS handshakes, including wrong CA and wrong hostname rejection, and inspect the actual
pg Client connection parameters to catch CA overwrite regressions. Real Supabase connectivity
from Vercel remains a later authorized Preview acceptance test.

## Branch and deployment inspection

GitHub staging exists at 72a98235fdd5a6eeff768548b4eff20f1108736d when inspected (same as main).
This PR does not push to staging or main. The repository policy permits automatic Git deployment
only for staging; this feature branch and main are disabled. The ignore step permits only
VERCEL_ENV=preview plus VERCEL_GIT_COMMIT_REF=staging. Build and runtime also reject Production.

This makes staging eligible for Preview after the code is reviewed and brought to staging;
it does not prove the hosted project has the right branch mapping. No Vercel account connector
is available here to inspect project settings. Before a later authorized deployment, the owner
must confirm Production Branch is NOT staging, Root Directory=v3, include outside-root sources,
Preview variable scope and Deployment Protection. Do not manually override VERCEL_ENV.
If the project incorrectly classifies staging as production, the build is rejected, not promoted.
Manual prebuilt deployment or promoting an existing deployment is outside these repository guards;
do not perform either during Staging setup.

The user described port 6543 as Session Pooler. Supabase's shared pooler normally uses 6543 for
transaction mode and 5432 for session mode. Preserve the tested exact endpoint and verify its mode
in Connect; this patch does not change the URL port. CA hostname validation targets the pooler host.

## Later verification / rollback

After review and explicit deployment authorization: populate Preview CA/URL, confirm branch mapping,
update staging, then test a real authenticated read and TLS errors without exposing connection strings
in logs. No /health result alone proves database connectivity. Do not rerun migrations already applied.
Rollback the application PR if needed, but do not weaken TLS to make the previous code connect.

References:
- https://node-postgres.com/features/ssl
- https://vercel.com/docs/project-configuration/git-configuration
- https://vercel.com/docs/project-configuration/vercel-json#ignorecommand
