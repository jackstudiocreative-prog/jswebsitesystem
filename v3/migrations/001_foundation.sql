CREATE TABLE staff (
 subject text PRIMARY KEY,
 role text NOT NULL CHECK (role IN ('admin','editor','viewer')),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE collections (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 90),
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active'))
);
CREATE TABLE products (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 150),
 handle text NOT NULL UNIQUE CHECK(handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')),
 collection_id bigint REFERENCES collections(id) ON DELETE RESTRICT,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE media (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 object_key text NOT NULL UNIQUE,
 mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
 bytes bigint NOT NULL CHECK(bytes > 0 AND bytes <= 10000000),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready')),
 created_by text NOT NULL REFERENCES staff(subject),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE product_media (
 product_id bigint NOT NULL REFERENCES products(id),
 media_id bigint NOT NULL REFERENCES media(id),
 position integer NOT NULL CHECK(position >= 0),
 alt text NOT NULL DEFAULT '',
 PRIMARY KEY(product_id,media_id), UNIQUE(product_id,position)
);
CREATE TABLE audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor text NOT NULL REFERENCES staff(subject),
 action text NOT NULL,
 entity text NOT NULL,
 entity_id bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- No demo accounts, products, orders, passwords or payment records are seeded.
-- Private API-only schema: do not expose these tables through PostgREST.
REVOKE ALL ON staff,collections,products,media,product_media,audit_events FROM PUBLIC;
