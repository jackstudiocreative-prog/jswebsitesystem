# Jack Studio Commerce Admin System

**Status: development prototype — not a production commerce service.**

There are currently two entry points:

1. [`index.html`](./index.html) — a **public GitHub Pages demo**, using browser-local storage. Anyone can open it. It is not an authenticated administration system and does not synchronize changes between devices.
2. [`jackstudio-admin-mvp/`](./jackstudio-admin-mvp/) — a **locally running Node.js + SQLite backend** with login, products, media uploads, orders demo data, and editable website content. It is not deployed by GitHub Pages.

## Try the public demo

[Open the GitHub Pages UI](https://jackstudiocreative-prog.github.io/jswebsitesystem/).

The demo supports product add/edit/delete, SKU validation, browser-local collection management, content drafts, published version history, restoring an older draft, a separate Publish action, and a storefront preview. These changes are stored **only in the current browser**.

## Run the local backend

Requires Node.js >=22.13:

```bash
cd jackstudio-admin-mvp
npm test
npm start
```

Open `http://localhost:3000/admin` for the admin UI and `http://localhost:3000/store` for the storefront demo. Local testing uses the documented sample login; **never expose that login publicly**. Set a new `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 16 characters) before allowing a non-loopback host.

### New features from the audit fix

- Separate **Save Draft**, **Preview Draft**, **Publish** and **Unpublish** actions for Website Pages.
- Database migration retains existing live content until an explicit Publish.
- Login attempt throttling and strict non-demo password requirement for non-local/production hosting.
- CI workflow runs syntax checks and Node.js smoke tests.
- GitHub Pages remains labeled clearly as an unsafe-for-real-data static demo.

## Still not ready for production

- No online shared database or real user/staff identity service; local SQLite is for prototype use.
- No real checkout, payment gateway, inventory reservation, refunds or shipping.
- No true block-based page builder, multi-variant catalogue or automatic SEO/analytics integrations.
- GitHub Pages cannot run the Node.js backend.
- Do not enter actual customer data or live sales records in this repository or the public preview.

See [`docs/ROADMAP.md`](./docs/ROADMAP.md) for priorities and the launch checklist.


### Second update (prepared, not yet on GitHub)
- Collections now have real local-database CRUD and safely migrate existing categories.
- Website Pages show published version history and can restore a previous version as a draft.
- The GitHub Pages demo also includes browser-local Collections and page history controls. It remains an explicitly non-authenticated static preview.
