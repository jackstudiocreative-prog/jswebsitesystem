# First staff invitation — Staging only

This PR targets staging. It does not send invitations, change hosted settings, deploy, provision
staff, execute migrations or modify main/Production/Shopify. Existing Auth users are reported empty.

## Implemented flow

1. An authorized operator invites staff from Supabase Authentication → Users → Invite user.
2. Keep the default Invite user email link using `{{ .ConfirmationURL }}`. Supabase verifies the
   one-time invitation before redirecting to `/admin` with an implicit session fragment. Invites
   originate in another browser and do not use the recovery flow's PKCE verifier.
3. The page captures and removes callback parameters before network requests, disables automatic
   SDK URL detection, explicitly sets the session and verifies identity with Auth `getUser()`.
   It requires an invited identity, shows the account email and asks for a 16-character minimum
   password plus confirmation. Never proceed if the displayed email is not yours.
4. After Auth accepts the new password, the same in-memory session continues to TOTP enrollment
   and challenge/verification. No password or session tokens are persisted to localStorage.
5. Workspace access still requires the API's signed JWT, aal2, and an active `public.staff` row
   for that subject. Roles come exclusively from the database, never invite metadata. An invited
   user absent from staff, inactive, or without MFA is denied. Invitation creates no Admin grant.

Recovery still uses PKCE in the initiating browser tab, updates the password then signs out globally.
Implicit recovery links are also handled. Ordinary password login and logout remain available.
Invalid/expired, ambiguous, duplicate or unsupported callbacks fail closed with a generic message;
URL error descriptions/tokens are not displayed. Custom token_hash email templates are not supported
by this flow; retain ConfirmationURL. Consumed links cannot be reused. If a tab closes before setting
a password, request password recovery from `/admin` and open that recovery email in the same tab.

This UI gates the invitation flow; it does not introduce a server-side password-completion column
or claim to enforce password setup independently of Supabase. The server's security boundary remains
verified Auth identity + MFA + active staff allowlist. Set the provider minimum password length to
16 as well, since browser validation alone cannot constrain direct Auth API calls.

## Platform prerequisites (owner actions after code review / authorized Preview release)

- Authentication → URL Configuration: Site URL and exact allowed Redirect URL are
  `https://jswebsitesystem-git-staging-js-design.vercel.app/admin`. No production URL or wildcard needed.
- Authentication → Sign In / Providers: enable Email; keep **Allow new users to sign up OFF**.
  Configure minimum password length 16; enable TOTP MFA. No frontend signup or admin API is added.
- Authentication → Email / SMTP Settings: configure a dedicated tested SMTP sender for ordinary
  employee addresses. The default Supabase SMTP sends only to project team addresses and is limited
  to 2 emails/hour; it is not a general staff mail service. Follow sender-domain verification required
  by the mail provider (SPF/DKIM), use a separate authorized test sender, and disable email link tracking.
  Do not modify Shopify/DNS as part of this PR. SMTP secrets stay in Supabase, not browser/Vercel public config.
- Review Invite user and Reset password templates and mail rate limits. Email security scanners can
  consume one-time links; investigate SMTP/provider logs if a fresh link is already expired.
- Before staff access, an authorized database owner must separately approve each Auth UUID, role and
  active status in `public.staff` using existing procedures. The runtime login cannot create staff.
  No staff SQL or migration is run by this PR. The first employee is not automatically an Admin.
- Frontend configuration remains SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY only. Never put a Secret
  Key/service-role key in the frontend. Restricted DATABASE_URL / CA remain server-only.
- Vercel Deployment Protection, if enabled, must let the intended tester reach the Preview URL.
  The feature branch is excluded by the existing staging-only Git/build policy. Review and merge
  only under a separately authorized release: merging into staging may trigger its Preview deployment.

## Acceptance still required on the eventual Preview

Tests use provider doubles and execute the actual page event handlers; CI also checks real PostgreSQL
permissions. They do not prove SMTP delivery or a live browser/Supabase callback. After an authorized
Preview release, test a fresh invitation, account-email confirmation, short/mismatched password,
valid password → QR scan → TOTP, allowlisted Editor access, absent/inactive staff denial, logout,
ordinary login, same-tab recovery, and expired/used links. No real invitation has been sent by this work.

References:
- https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail
- https://supabase.com/docs/guides/auth/sessions/implicit-flow
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/rate-limits
