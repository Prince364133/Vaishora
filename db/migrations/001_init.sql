-- VAISHORA core schema. PostgreSQL 15+ (Supabase compatible; also runs on PGlite for local dev).
-- Money is stored in paise (integer). Timestamps are timestamptz (UTC); the app presents IST.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'staff', 'artist')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id text PRIMARY KEY,                 -- sha256 of the session token; the token itself is never stored
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL UNIQUE CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- catalogue
CREATE TABLE localities (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  zone text NOT NULL,
  city text NOT NULL DEFAULT 'Hyderabad',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE design_categories (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]+$'),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name text NOT NULL,
  category_slug text NOT NULL REFERENCES design_categories(slug) ON UPDATE CASCADE,
  description text NOT NULL DEFAULT '',
  region text NOT NULL CHECK (region IN ('palm', 'back', 'palm_back', 'feet')),
  complexity text NOT NULL CHECK (complexity IN ('simple', 'moderate', 'intricate', 'bridal')),
  duration_minutes int NOT NULL CHECK (duration_minutes BETWEEN 10 AND 600),
  base_price_paise int NOT NULL CHECK (base_price_paise >= 0),
  artist_eligibility text NOT NULL DEFAULT 'standard' CHECK (artist_eligibility IN ('standard', 'senior', 'bridal_specialist')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'draft', 'unavailable')),
  featured boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX designs_category_idx ON designs(category_slug) WHERE status = 'active';

CREATE TABLE design_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id uuid NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('palm', 'back', 'feet')),
  url text NOT NULL,
  source text NOT NULL CHECK (source IN ('generated', 'upload')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (design_id, kind)
);

-- ---------------------------------------------------------------- artists
CREATE TABLE artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name text NOT NULL,
  phone text NOT NULL,
  bio text NOT NULL DEFAULT '',
  photo_url text,
  instagram text,
  experience_years int CHECK (experience_years BETWEEN 0 AND 60),
  experience_verified boolean NOT NULL DEFAULT false,
  skill_level text NOT NULL DEFAULT 'standard' CHECK (skill_level IN ('standard', 'senior', 'bridal_specialist')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
  verified_at timestamptz,
  verification_notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artist_portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  caption text NOT NULL DEFAULT '',
  sort int NOT NULL DEFAULT 0
);

CREATE TABLE artist_services (
  artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  category_slug text NOT NULL REFERENCES design_categories(slug) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (artist_id, category_slug)
);

CREATE TABLE artist_service_areas (
  artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  locality_id int NOT NULL REFERENCES localities(id) ON DELETE CASCADE,
  PRIMARY KEY (artist_id, locality_id)
);

-- Weekly working hours in IST, as minutes from midnight.
CREATE TABLE artist_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
  start_minute int NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute int NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
  CHECK (end_minute > start_minute)
);
CREATE INDEX artist_availability_idx ON artist_availability(artist_id, weekday);

CREATE TABLE artist_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  period tstzrange NOT NULL,
  reason text NOT NULL DEFAULT ''
);
CREATE INDEX artist_time_off_idx ON artist_time_off USING gist (artist_id, period);

-- ---------------------------------------------------------------- pricing
CREATE TABLE pricing_rules (
  code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]+$'),
  group_code text NOT NULL CHECK (group_code IN ('hands', 'side', 'coverage', 'addon', 'people')),
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_multiplier numeric(6, 3) NOT NULL DEFAULT 1 CHECK (price_multiplier >= 0),
  flat_paise int NOT NULL DEFAULT 0 CHECK (flat_paise >= 0),
  duration_multiplier numeric(6, 3) NOT NULL DEFAULT 1 CHECK (duration_multiplier >= 0),
  flat_minutes int NOT NULL DEFAULT 0 CHECK (flat_minutes >= 0),
  is_default boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code = upper(code)),
  kind text NOT NULL CHECK (kind IN ('percent', 'flat')),
  value int NOT NULL CHECK (value > 0),
  min_order_paise int NOT NULL DEFAULT 0,
  max_discount_paise int,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit int,
  used_count int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 100)
);

-- ---------------------------------------------------------------- bookings
CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  access_token_hash text NOT NULL UNIQUE,
  idempotency_key text UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  design_id uuid NOT NULL REFERENCES designs(id),
  artist_id uuid REFERENCES artists(id),
  status text NOT NULL CHECK (status IN (
    'pending_payment', 'paid', 'awaiting_artist_assignment', 'awaiting_artist_confirmation',
    'confirmed', 'in_progress', 'completed', 'cancelled', 'expired', 'refund_pending', 'refunded')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  block tstzrange NOT NULL,             -- service time plus travel/preparation buffers
  duration_minutes int NOT NULL,
  people_count int NOT NULL DEFAULT 1 CHECK (people_count BETWEEN 1 AND 20),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  address_line text NOT NULL,
  locality_id int NOT NULL REFERENCES localities(id),
  city text NOT NULL,
  landmark text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  special_requirements text NOT NULL DEFAULT '',
  subtotal_paise int NOT NULL,
  discount_paise int NOT NULL DEFAULT 0,
  fee_paise int NOT NULL DEFAULT 0,
  tax_paise int NOT NULL DEFAULT 0,
  total_paise int NOT NULL,
  advance_paise int NOT NULL,
  coupon_id uuid REFERENCES coupons(id),
  hold_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (advance_paise <= total_paise),
  -- The core double-booking guarantee: one artist can never hold two overlapping active bookings.
  CONSTRAINT bookings_no_artist_overlap EXCLUDE USING gist (artist_id WITH =, block WITH &&)
    WHERE (artist_id IS NOT NULL AND status IN (
      'pending_payment', 'paid', 'awaiting_artist_confirmation', 'confirmed', 'in_progress'))
);
CREATE INDEX bookings_customer_idx ON bookings(customer_id);
CREATE INDEX bookings_status_idx ON bookings(status);
CREATE INDEX bookings_starts_idx ON bookings(starts_at);
CREATE INDEX bookings_artist_idx ON bookings(artist_id, starts_at);

CREATE TABLE booking_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('design', 'option', 'addon', 'people', 'discount', 'fee', 'tax')),
  code text NOT NULL,
  label text NOT NULL,
  quantity int NOT NULL DEFAULT 1,
  amount_paise int NOT NULL,
  sort int NOT NULL DEFAULT 0
);
CREATE INDEX booking_items_booking_idx ON booking_items(booking_id);

CREATE TABLE booking_status_history (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('system', 'customer', 'admin', 'artist', 'webhook')),
  actor_id uuid,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_status_history_idx ON booking_status_history(booking_id, created_at);

-- ---------------------------------------------------------------- payments
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  provider text NOT NULL CHECK (provider IN ('razorpay', 'mock')),
  provider_order_id text NOT NULL,
  provider_payment_id text,
  amount_paise int NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL CHECK (status IN ('created', 'attempted', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded')),
  failure_reason text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_order_id),
  UNIQUE (provider, provider_payment_id)
);
CREATE INDEX payments_booking_idx ON payments(booking_id);

CREATE TABLE payment_events (
  id text PRIMARY KEY,                  -- provider event id; makes webhook handling idempotent
  provider text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  provider_refund_id text UNIQUE,
  amount_paise int NOT NULL CHECK (amount_paise > 0),
  status text NOT NULL CHECK (status IN ('pending', 'processed', 'failed')),
  reason text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- engagement
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
  artist_id uuid REFERENCES artists(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  template text NOT NULL,
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artist_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  localities text NOT NULL DEFAULT '',
  experience text NOT NULL DEFAULT '',
  instagram text,
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'onboarded', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  booking_code text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity, entity_id);

-- ---------------------------------------------------------------- access control
-- The application talks to Postgres from the server only, as the table owner.
-- Row level security is enabled with no policies so that the public Supabase REST and
-- GraphQL APIs (anon / authenticated roles) cannot read or write any table directly.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
