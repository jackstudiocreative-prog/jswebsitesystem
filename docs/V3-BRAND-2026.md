# Jack Studio 2026 interface refresh

Brand source: the reference image supplied by the owner on 18 November 2026.

| Token | Colour | Role |
| --- | --- | --- |
| Espresso | `#401410` | Dark text and hover states |
| Ivory | `#FBF8F0` | Main canvas |
| Saddle Tan | `#C38239` | Small decorative accents |
| Sage | `#8DA68A` | Navigation selection and emphasis |
| Olive | `#6B5D45` | Primary actions, headings, secondary text |

Bebas Neue is used for large headings, Inter for controls and body copy, and Georgia Italic for taglines. Fonts are self-hosted. Sage backgrounds use Espresso text; primary actions use Ivory on Olive. No new pure-black brand token is introduced.

The shared `v3/shared/brand-2026.css` layer is copied by the build and loaded in staff, storefront and editor preview documents. Liquid mounts keep it after dynamically loaded theme styles. Global header/action branding is intentional; section-specific artwork and saved theme content remain intact. New theme defaults use the supplied palette. Existing saved colour settings are not migrated.

## Interaction changes

- Dashboard shows four primary metrics, actionable tasks and shortcuts. Eight additional metrics are disclosed on demand. Totals explicitly say all-time; no unimplemented date filter or synthetic chart is shown.
- Product and media import tools are collapsed initially and remain open while an import runs.
- Pages has its own navigation destination. Website remains the theme overview, with its previous page tools accessible in an expandable section.
- The same card, form, table, status and button rules cover the existing catalogue, variants, collections, inventory, orders, customers, media, settings and editors.
- Storefront typography, header/navigation, actions, product, cart, checkout and footer styling share the brand layer, with responsive layouts.

## Scope and validation

This is a layout and interaction refresh of existing V3 functionality, not full Shopify feature parity. Payment processing, permissions, database migrations, production hosting and public-image delivery are unchanged. In particular, product image placeholders remain where the existing public delivery pipeline provides no images. No new analytics, marketing, discount engine, membership or Shopify integration is claimed.

Use `npm test`, `npm run build`, and `npm run e2e` from `v3`. The browser suite covers product edits, stock, page publishing, themes, preview, orders, checkout and mobile navigation. The original suite contains scoped colour-contrast exemptions for legacy storefront content; passing it is not a claim of a complete accessibility audit. Three real-PostgreSQL tests require the separately configured test database.

Review the feature branch against staging before merging. A staging merge can trigger a Vercel Preview deployment.
