# V3 functional inventory — 18 November 2026

Base: `design/jack-studio-2026` at `a12a134` (one commit ahead of `staging` at `a414d0e`; not merged).
Work branch: `update/v3-commerce-core`. Evidence is the code, the unit/integration suite
(`npm test`, PGlite) and the browser suite (`npm run e2e`, mock gateway, in-memory database),
not earlier documents. Nothing here was run against the hosted Supabase, Cloudinary or eGHL.

Status key: **Works** = implemented and covered by tests · **Partial** = usable with stated gaps ·
**Missing** = not implemented · **External** = code exists, needs credentials, an account or a
hosted configuration before it can be called working.

## Catalogue and media

| Module | Status | Notes |
|---|---|---|
| Products: create/edit, status draft/active/archived, handle, description, tags, revision check | Works | `src/catalog.mjs`, unsaved-change prompt in admin |
| Variants: up to 3 options, SKU (unique), price, compare-at, per-variant image, deactivate | Works | `src/inventory.mjs`; compare-at needs migration 010 |
| Inventory ledger: reasons, history, counted quantity with stale-count check | Works | append-only `inventory_adjustments` |
| Collections: CRUD, product membership, position | Works | no collection image or automated (rule-based) collections |
| Media library: signed private upload, verified finalize, picker with search/filter | Works | originals are `authenticated` Cloudinary assets |
| Shopify import (catalogue + images, verify against Shopify) | Works / External | staff tool; needs Cloudinary and the public Shopify store |
| **Public product/page images** | **Was missing → Works (this branch)** | see "Batch 1" below |

## Storefront

| Module | Status | Notes |
|---|---|---|
| Home and theme pages from the imported Shopify Liquid sections | Works | live theme only |
| `/pages/<slug>` published V3 pages, redirects after URL change | Works | |
| Product page | **Partial → Works (this branch)** | gallery, variant image, compare-at, breadcrumb, theme header/footer |
| Collection pages `/collections/<handle>`, `/collections/all` | **Missing → Works (this branch)** | sort, in-stock filter, paging, empty states |
| Theme quick-add / cart badge / cart drawer (Shopify AJAX cart calls) | **Broken → Works (this branch)** | `web/cart-bridge.mjs` answers `/cart.js`, `/cart/add.js`, `/cart/change.js`, `/products/<h>.js` from the V3 bag |
| Bag, server-priced quote, low-stock/sold-out messages | Works | bag lives in the browser; prices always from the server |
| Search | Missing | theme search section has no backend |
| Customer accounts / JS Membership | Missing / External | guest checkout only; integration contract not provided |
| Wishlist | Partial | theme script, browser-local only |

## Checkout, payments, orders

| Module | Status | Notes |
|---|---|---|
| Checkout: Malaysian address, idempotent attempt key, rate limits, 3-pending cap | Works | |
| Shipping rules (RM5 < RM49, free ≥ RM49, luggage RM26.90, mixed bag) | Works | |
| Stock reservation 30 min, release on expiry | Works (code) / External | expiry endpoint exists; scheduler **not enabled** (see V3-AUDIT) |
| Mock gateway: approve/decline/pending/retry | Works | staging only |
| eGHL hosted payment | External | request/response hash order unverified; sandbox credentials and merchant document needed |
| Duplicate/late callbacks, no double deduction, second payment flagged | Works (tests) | provider behaviour unverified |
| Orders admin: list/filter, detail, fulfil with tracking, cancel, record refund + restock, resolve attention | Works | refunds are records of portal refunds, not gateway refunds |
| Customers list | Partial | derived from orders; no profiles/accounts |
| Order emails | External | queued in outbox; no SMTP provider configured |

## Website editor and themes

| Module | Status | Notes |
|---|---|---|
| Theme library, create/duplicate/publish/archive, revision check | Works | |
| Theme editor: sections, blocks, Liquid page templates, preview desktop/mobile | Works | |
| Pages: templates, sections, draft/preview/publish/unpublish/restore | Works | |
| Brand layer vs saved theme colours | Not verified | `brand-2026.css` loads after theme CSS and sets header/action colours; whether it hides colour settings staff can still edit is checked in batch 3 |

## Operations

| Module | Status | Notes |
|---|---|---|
| Dashboard: 4 primary metrics, tasks, more on demand | Works | totals are all-time; no date filter |
| Staff auth: invite, password, MFA, viewer/editor/admin | Works / External | Supabase hosted acceptance outstanding |
| SEO: sitemap (published pages), robots (noindex on staging), product/collection meta | Partial | sitemap does not yet list products/collections |
| Discounts, gift cards, reports, notifications beyond order email | Missing | need business rules |

## Batch plan

1. **Catalogue ↔ storefront (this branch, done):** public images, collection pages, product gallery,
   cart thumbnails, theme cart bridge, consistent listing rule. Details in
   [V3-STOREFRONT-CATALOG.md](V3-STOREFRONT-CATALOG.md).
2. **Admin daily operations:** consistent list/search/filter/detail/error patterns across products,
   collections, inventory, orders, customers, media; tasks link to the filtered work.
3. **Website and editor:** brand vs theme setting precedence, collection/product pages inside the
   theme, sitemap products/collections.
4. **Orders and payments:** re-verify reservation/expiry/refund paths; eGHL only with sandbox evidence.
5. **Operations:** search, notifications, discounts, reports — after business rules are supplied.
