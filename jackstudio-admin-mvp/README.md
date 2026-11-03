# Jack Studio Commerce Admin — First Working MVP

A Shopify-inspired **independent website admin prototype**. It has a real Node.js backend, a local SQLite database, and a public demo storefront. No Shopify connection or third-party dependencies are needed to try it locally.

## Quick start (Windows / macOS / Linux)

1. Install **Node.js 22.13 or newer**.
2. Extract the entire ZIP file into a folder.
3. Open Terminal / PowerShell in the extracted folder.
4. Run `npm start` (there is no `npm install` step; no npm dependencies).
5. Open **http://localhost:3000/admin**.
6. Use the local demo account:
   - Email: `admin@jackstudio.local`
   - Password: `JackStudio2026!`
7. Public preview: **http://localhost:3000/store**.

If port 3000 is busy: PowerShell `$env:PORT=4000; npm start`; macOS/Linux `PORT=4000 npm start`.

> **Important:** These sample credentials are deliberately documented for local testing. **Never publish this app to the public internet with the sample account.** For real deployment, provision new secure credentials and migrate the local SQLite database, upload storage, authentication, and session management to hardened managed services.

## What is working

- Shopify-inspired responsive dashboard + sidebar/navigation
- Sign-in and sign-out using hashed passwords and HTTP-only session cookies
- Local persistent SQLite database (`data/jackstudio.sqlite`)
- Product creation, update, deletion, status and inventory field
- Products automatically shown in the standalone demo store
- Collections grouped by product category
- Basic orders list and fulfilment status updating **on sample orders**
- Sample customer list and demo analytics clearly identified as synthetic
- Editable content pages with published / draft status
- Editable homepage hero, announcement bar and basic store settings
- Media library: upload JPEG, PNG, WEBP up to 4MB, copy uploaded URL
- Desktop/mobile preview and basic browser-local cart (no real checkout)
- Audit activity feed for edits

## Not built / not production-ready

- Payments, refunds, real checkout, shipping, transactional notifications
- Actual orders and customer accounts / JS Membership integration
- Product variants, stock reservation, stock ledger, taxes, invoices
- Roles beyond a single admin user; staff invitation and MFA
- Cloud database / file storage and production-grade backups
- Real traffic instrumentation / SEO management and URL redirects
- Drag-and-drop website builder, 360-degree product viewer, 3D showroom
- Shopify data import; *all initial records are fake seeded demo data*

## Production path

- Move to a hosted PostgreSQL database (e.g., Supabase), cloud image storage, dedicated secure authentication, CSRF protections, rate limits, structured logs and real deployment CI.
- Keep payment handling with a gateway such as Stripe or Billplz and implement secure server-side transaction verification.
- Import real product data and images from Shopify after testing with copies.
- Deploy storefront and admin behind separately secured routes/domains.
- Complete security review, backup recovery rehearsal and PDPA/privacy compliance before public launch.

## Local environment settings

- `PORT` defaults to `3000`.
- `DATA_DIR` defaults to `./data` and determines where the SQLite database is stored.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` are applied **only on the very first startup** when no users exist.

For local testing, sample data is seeded at first startup (fake products, customers, orders, site pages, settings and sample chart data). Subsequent product and page updates survive restarts. To reset the demo, shut down the server and delete `data/jackstudio.sqlite` (this destroys all edits and uploaded image links).

## Files

- `server.mjs`: Node HTTP server, SQLite schema, seeded data, authentication, API routes and media uploads
- `public/admin.html`, `public/admin.js`, `public/styles.css`: Shopify-style administration frontend
- `public/store.html`, `public/store.js`: public storefront prototype
- `public/assets`: example product SVG placeholders + hero crop from the supplied website screenshot
- `data`: local database written when the app starts

**The product drawings are placeholders, not actual Jack Studio inventory photography.** Replace them with real images inside Media Library.
