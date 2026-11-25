-- Saved customer addresses (Google Maps places), real coordinates for localities, precise booking location.
-- Add-only.

-- Localities become Google-backed: a place id and coordinates, so any address can be matched to the
-- locality artists serve (same name, or the nearest one).
ALTER TABLE localities
  ADD COLUMN IF NOT EXISTS place_id text,
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS geocoded_at timestamptz,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'admin', 'google'));
CREATE UNIQUE INDEX IF NOT EXISTS localities_place_id_idx ON localities(place_id) WHERE place_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Home',                 -- Home / Work / Other / custom
  house text NOT NULL,                                -- flat / house number, floor
  building text NOT NULL DEFAULT '',                  -- building / apartment / street
  formatted_address text NOT NULL,                    -- from Google Maps
  place_id text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  locality_id int NOT NULL REFERENCES localities(id),
  landmark text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
);
CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx ON customer_addresses(customer_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_one_default_idx ON customer_addresses(customer_id) WHERE is_default;
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS address_id uuid REFERENCES customer_addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS place_id text;
