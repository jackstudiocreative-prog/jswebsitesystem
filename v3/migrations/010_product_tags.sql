-- Review before applying to Staging. Requires 009. Additive: Shopify product tags (the theme's series
-- shelves pick products by tag, e.g. cat-bag) and compare-at prices for sale prices.
ALTER TABLE products ADD COLUMN tags text[] NOT NULL DEFAULT '{}' CHECK(cardinality(tags)<=250);
ALTER TABLE product_variants ADD COLUMN compare_at_minor integer CHECK(compare_at_minor IS NULL OR compare_at_minor>=0);
