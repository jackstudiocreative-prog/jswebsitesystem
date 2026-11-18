# Storefront catalogue and public images (batch 1)

## One visibility rule

A visitor can see a product when it is **active** and belongs to **at least one active collection**.
The same rule (`LISTED` in `v3/src/storefront.mjs`, `SELLABLE` in `commerce.mjs`) drives the product
page, collection pages, theme product lists, the bag quote and image delivery. Draft or archived
products, products only in draft collections, inactive variants, SKUs, exact stock counts and storage
keys are never returned by public endpoints.

## Public images

Originals stay private (`authenticated` Cloudinary assets). Public pages reference images as
`/api/v3/storefront/media/<id>?w=<width>`. On every request the server checks that the image is shown
by the live storefront and only then answers with a 302 to a **signed, fixed-width derivative**
(`c_limit`, `q_auto`, WebP; never upscaled; Cloudinary strips metadata from transformed images).

An image qualifies when it is:

- the featured, gallery or variant image of a listed product;
- chosen in the **live** theme (V3 sections, Liquid page templates, header, footer, outlet photos);
- used in the **published** revision of a page.

Anything else — draft products, saved-but-not-live themes, unpublished pages, library-only images,
pending uploads, guessed IDs — returns 404. Widths are snapped to 320/640/960/1440/2048; the
transformation is chosen by the server, so a visitor cannot request the original or another size.

The redirect is cached for 5 minutes (`public, max-age=300, s-maxage=300`), so archiving or
unpublishing stops new deliveries within about 5 minutes. A derivative URL that someone already
copied keeps working (signed URLs have no expiry), so this is for product imagery that is meant to
be public, never for sensitive media. If Cloudinary is not configured the endpoint answers 503 and the
storefront shows the neutral placeholder (`web/image-fallback.mjs`).

No migration and no Cloudinary setting change is required. Optional hardening in the Cloudinary
console: enable **strict transformations** and allow only the five widths above.

## Storefront pages

- `/collections/<handle>` and `/collections/all`: sort (featured, newest, price, A–Z), in-stock filter,
  24 per page, empty-collection and nothing-in-stock messages, breadcrumb, meta description, canonical.
- `/products/<handle>`: gallery with thumbnails, the selected variant's own image, compare-at price,
  sold-out state, breadcrumb to its first collection, `og:image`.
- Bag: thumbnails and links back to each product.
- Product, collection, bag and checkout pages use the live theme's header and footer when a theme is
  live (mounted before content is shown).

## Theme cart compatibility

The imported Shopify theme calls the Shopify AJAX cart (`/cart.js`, `/cart/add.js`,
`/cart/change.js`, `/products/<handle>.js`). `web/cart-bridge.mjs` answers exactly these calls from the
V3 bag and public API; every add is checked by the server quote first, so unknown, unlisted or sold-out
variants are refused. Liquid product objects now carry the real variant IDs, prices and availability,
so quick-add buttons add the right variant. The theme's cart badge shows the bag count and its
accessible name includes the count.

## Tests

- `v3/tests/public-media.test.mjs`: delivery allowed/refused per rule, archive revokes, live vs saved
  theme, 503 when unconfigured, width snapping, product/collection/bag API shapes and leaks.
- `v3/e2e/storefront.spec.mjs`: collection page → sort → product page with srcset → bag thumbnail,
  missing collection; desktop and mobile.
