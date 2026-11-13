# V3 — Online Store themes

## Release boundary

Into `staging`. **Migration 009 must be applied before this version is used** (operator account, never
runtime). Until then the Website page shows "Themes are unavailable right now" and the Pages list keeps
working; the storefront home keeps its staging notice. main, Production, Shopify and the live website are
untouched.

## What it does (modelled on Shopify → Online Store)

- **Website → Current theme**: a preview of the live theme, its name, last saved and published times,
  **Edit theme**, **View store** (opens `/`), Duplicate and Rename.
- **Theme library**: themes that are not live. Publish (replaces the current theme; the old one returns to
  the library), Edit theme, Duplicate, Rename, Remove (archives; the live theme cannot be removed).
  **Add theme** from a preset. Up to 20 themes.
- **Edit theme**: left panel with **Header** (Announcement bar, Header), **Template · Home page**
  (add, edit, hide, reorder, remove sections) and **Footer**, plus **Theme settings** (colours, heading and
  body fonts, home page SEO). Live preview of unsaved changes at Desktop 1280 / Tablet 768 / Mobile 390.
  As in Shopify, saving the **live** theme updates the storefront immediately; duplicate it to work
  privately, then publish the copy. Viewers can open everything read-only.
- **Storefront**: `/` renders the live theme (header, home sections, footer). Published pages
  (`/pages/<slug>`) use the live theme's header and footer.

## Preset: Jack Studio 2026

Reproduces jackstudio.com.my ("Website design 2026"): announcement bar (2 messages), centred-logo header with
the same menu and the About Us drop-down, hero, icon row (More Trust / Relevant / Personal), collection
cards (7 series with their label colours), Corporate Solution + "185,249 customers" statistic with the
flip-digit animation, Best Seller product tabs, story split, Virtual Showroom, 3 outlets and the footer
(link columns, company details, socials, newsletter). Text, layout, colours and fonts are ported from the
Shopify sections; fonts (Bebas Neue, Inter — OFL-1.1) are self-hosted.

To finish it after adding the theme:
1. Choose images (logo, hero, collection cards, feature, statistic, story, showroom cover, outlets) from the
   Media Library.
2. Point each **Best Seller** tab at a collection.
3. Create the pages the menu links to (`/pages/brand-story`, `brand-promise`, `blog`, `our-services`,
   `product-collection`, `corporate-solution`, `outlets`, `contact`, and the four policy pages) or edit the links.

Differences from Shopify, by design: the showroom opens in a new tab (the storefront CSP blocks embedded
frames); icons for search / account / wishlist only appear when a link is set (V3 has no such pages yet);
the newsletter form shows "not connected yet" until an email provider exists.

## Migration 009

| Table | Purpose |
|---|---|
| `themes` | name, preset, validated `content jsonb` (settings, header, sections, footer), `is_live`, `archived`, `revision`, `published_at`, `updated_by` |

A partial unique index allows only one live theme; a check forbids a live archived theme. RLS with the
`server_access` policy; grants `jackstudio_api` SELECT/INSERT/UPDATE (no DELETE — removing archives) and
sequence usage; anon/authenticated revoked. Rollback: return to the previous app; the table is unused there.

## API

Private (staff JWT, MFA aal2; writes need Admin/Editor): `GET|POST /api/v3/themes`
(`{preset}` or `{from}` to duplicate), `GET|PATCH /api/v3/themes/:id` (`{revision, name?, content?}`),
`GET /api/v3/themes/:id/preview`, `POST /api/v3/themes/preview` (unsaved, writes nothing),
`POST /api/v3/themes/:id/publish|archive` (`{revision}`). Public: `GET /api/v3/storefront/theme` (live theme only).

## Safety

- One shared schema (`v3/shared/theme-schema.mjs`) drives the editor forms and API validation: unknown
  fields and section types are rejected, links must be `/path`, `https://`, `mailto:` or `tel:`, colours must
  be `#rrggbb`, lists have limits, images must be verified ready media, collections must exist.
- Every text value is escaped. The storefront CSP forbids inline styles, so section colours are emitted as
  `data-jt-vars` and applied through CSSOM after re-validation; the sandboxed admin preview gets style
  attributes instead and runs no scripts.
- Saves, publishes and removals lock the row and check the revision (stale editors get a 409); every
  change is written to `audit_events`.

## Known limits

- Public image delivery is still disabled V3-wide, so the storefront shows image placeholders; the admin
  preview shows the real images.
- Accessibility: the preset keeps jackstudio.com.my's brand colours, which miss WCAG AA contrast in a few
  places (white on sage announcement bar, white on tan buttons, some secondary text). This is recorded as a
  pending brand decision in `e2e/helpers.mjs`, like the existing V2 button exception; staff can adjust the
  colours in Theme settings and section settings.

## Tests

`tests/themes.test.mjs` (schema, API, permissions, publish/archive rules, audit, grants, renderer escaping
and CSP-safe output), `tests/theme-ui.test.mjs` (Online Store and editor on the real admin markup, viewer
read-only, themes unavailable), `e2e/themes.spec.mjs` (add → edit → save → publish → storefront home,
drop-down menu, tabs, mobile drawer, axe and CSP checks).

## Shopify images and auto-fill

Media Library → **Import from Shopify** copies the Shopify image library into the private Cloudinary
media library, four images per request, while the admin tab stays open. The list is the committed
manifest `v3/src/shopify-media.mjs` (1,987 images: every product image from the products export plus
every collection, theme and content image the Shopify site uses). The endpoint only accepts paths from
that manifest, so it cannot be used to fetch arbitrary URLs.

- `GET /api/v3/media/import` — total, imported count and the paths still pending (viewers allowed).
- `POST /api/v3/media/import {paths:[…up to 4]}` — editors only. Cloudinary downloads each file from
  `cdn.shopify.com` with a signed server-side upload (`type: authenticated`, `overwrite: false`, the
  same upload preset), the reply is checked with `validateAsset`, and a ready `media` row is added with
  the Shopify file name as its label. Each path has a fixed public ID
  (`jackstudio-websitesystem/shopify/<sha256>`), so re-runs skip finished images; failed images stay
  pending and are listed in the Media Library. No migration is needed.

Theme auto-fill uses the same fixed IDs. `THEME_IMAGES` in `v3/src/shopify-import.mjs` lists the image
jackstudio.com.my uses in each slot (logos, hero, the seven collection cards, corporate and statistic
images, story image, About Us menu tiles, outlet photos). New themes from the Jack Studio 2026 preset
fill automatically; **Auto-fill images** on a theme (`POST /api/v3/themes/:id/autofill {revision}`)
fills empty slots of an existing theme. Images staff picked themselves are never replaced; duplicates
stay exact copies. The virtual-showroom cover was a Shopify theme asset, not a library file, so upload
it in the Media Library and pick it in the theme editor.

## Virtual showroom (embedded)

The 3D showroom from `jackstudiocreative-prog/js-showroom` (JackStudio_Matterport_Concept_V5) is copied
into `v3/showroom/` by `v3/scripts/import-showroom.py` and served at `/showroom/`. The script moves the
textures out of JavaScript into WebP files (about 66 MB down to about 7 MB to load), so it opens quickly.
The home-page section shows it inside the page (no new page): the cover image shows while it loads, it
starts loading as soon as the rest of the page has loaded (or when visitors get within two screens), and
its render loop pauses while it is scrolled out of view. The old GitHub Pages link maps to `/showroom/`;
any other link keeps the cover-and-link behaviour. Re-run the script after changing the showroom repo.
`/showroom/*` may be framed by this site only (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`).

## Other pages from the Shopify theme (Liquid)

The menu pages (brand story, brand promise, our services, corporate solution, outlets, contact, product
collection and the four policies) are built from the original Shopify Liquid sections, so they look the same
as on Shopify. `v3/scripts/import-shopify-theme.mjs` copies the theme export into `shared/liquid-theme.mjs`
(section schemas and each page's sections/settings, links rewritten to V3 addresses) and
`src/liquid-files.mjs` (Liquid sources, outlet entries); `src/liquid.mjs` renders them with liquidjs.

- Storefront: `/pages/<slug>` asks `GET /api/v3/storefront/theme/pages/<slug>` (live theme only), adds the
  theme's global stylesheet, `runtime.js` and the section scripts from
  `GET /api/v3/storefront/theme/scripts.js?s=type:id,…`. Inline section scripts and onclick handlers are
  moved out of the markup, so `script-src 'self'` stays strict. `style-src` now allows inline styles (the
  Shopify sections use them, as on Shopify). YouTube/Vimeo embeds and thumbnails are allowed.
- Theme editor: the page picker at the top of the panel switches between the home page and these pages.
  Sections and blocks use forms generated from their Shopify schema; "Page title and text" edits the page
  text used by the policy pages. Edits are stored in the theme as `content.templates[slug]`; pages never
  edited use the Shopify defaults. `POST /api/v3/themes/preview-pages` renders unsaved pages for staff.
- Not carried over yet: Shopify-hosted videos (the YouTube link is used), product tags for the series
  shelves on Product Collection, and sending the contact/newsletter forms (they say so instead of
  pretending to send). Images follow the media rules above (placeholders on the public site until public
  image delivery is enabled).
