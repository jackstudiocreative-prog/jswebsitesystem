# Jack Studio admin: audited roadmap

## V2 implemented and merged in PR #1

1. GitHub Pages UI: local draft/save/publish process, published pages preview, duplicate SKU prevention; the demo remains public and browser-local.
2. Local Node server: safe-by-default loopback binding; reject non-demo public/production startup without a strong admin password; login failure throttling; explicit admin authorization.
3. Backend page publishing: database migration for draft fields; `PUT /api/pages/:id` saves only drafts; `POST /api/pages/:id/publish` promotes draft to public; `POST /api/pages/:id/unpublish` hides public content.
4. Collections CRUD: collection name/description/status, rename propagation and deletion safeguards; browser-local mirror in static demo.
5. Page version history: each Publish creates a revision; Restore creates an unpublished draft; browser-local mirror in static demo.
6. Tests: draft not visible until published, unpublish, history restore, collection CRUD, throttling, CI runner (8 tests).

## P0: prerequisites for a live shared admin

- Agree on production hosting (Vercel app vs dedicated Node container). **Do not deploy this SQLite server as-is to Vercel serverless.**
- Create hosted PostgreSQL database and object storage (e.g. Supabase); migrate schema, data and uploaded images.
- Implement proper staff authentication with MFA, admin/editor/viewer role checks, CSRF/session controls and audit logs.
- Do not make demo data and hard-coded sample credentials available to live users.

## P1: business-critical features

- Catalogue: variants, color/SKU per variant, inventory ledger, bulk operations, collections ordering.
- Website editor: section components, richer layout builder, online preview and server-side publishing; basic revision restore is implemented in the local backend.
- Commerce: cart state on server, checkout, Malaysia payment gateway, webhook verification and idempotency, shipping, refunds and email notifications.
- Real media: signed uploads, resizing/compression, safe filenames, retention policies.
- Integration with existing JS Membership system only after validating its supported SSO/API contract.

## P2: quality and marketing

- Analytics & Search Console, Meta/SEO, sitemap, canonical URLs, 301 redirects.
- Showroom editor and corporate gifting content workflows.
- Accessibility, localization, responsive cross-browser checks, monitoring, backups, PDPA review.

## Before publishing

- [ ] Rotate all demo credentials and remove sample customers/orders
- [ ] Confirm real staff-only login + MFA and roles
- [ ] Verify database backups, restore procedures and image storage
- [ ] Test failed / duplicate / refunded payments and overselling protection
- [ ] Import and validate product SKUs, images, URLs, SEO redirects
- [ ] Test mobile/desktop store and admin with real users
- [ ] Run CI checks and security review

## V3 sequence from the independent 2026-11-04 Audit
Start with the [P0 foundation](V3-FOUNDATION.md). Hosted identity/MFA/reset, object storage, UI adapters and staging recovery remain acceptance gates. Only then proceed with P1 catalogue variants, inventory, section editor and commerce integrations. Do not mark a phase complete based solely on schema scaffolding.
