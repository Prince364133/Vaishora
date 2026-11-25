-- Artist platform: self-serve artist applications and verification, artist-owned designs with
-- moderation, schedules, earnings ledger and payouts, support tickets, email delivery log.
-- Add-only: no table or column is dropped and no existing row is rewritten (safe on a live database).

-- ---------------------------------------------------------------- artists
ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS email text CHECK (email IS NULL OR email = lower(email)),
  ADD COLUMN IF NOT EXISTS identity_sub text,                            -- 180 Identity subject, bound on first sign-in
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT 'Hyderabad',
  ADD COLUMN IF NOT EXISTS areas_text text NOT NULL DEFAULT '',          -- areas the applicant said they cover
  ADD COLUMN IF NOT EXISTS experience_text text NOT NULL DEFAULT '',     -- applicant's own description
  ADD COLUMN IF NOT EXISTS portfolio_url text,
  ADD COLUMN IF NOT EXISTS application_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS languages text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS margin_bp int CHECK (margin_bp IS NULL OR margin_bp BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS max_bookings_per_day int CHECK (max_bookings_per_day IS NULL OR max_bookings_per_day BETWEEN 1 AND 20);

CREATE UNIQUE INDEX IF NOT EXISTS artists_email_idx ON artists (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS artists_identity_sub_idx ON artists (identity_sub) WHERE identity_sub IS NOT NULL;

ALTER TABLE artists DROP CONSTRAINT IF EXISTS artists_status_check;
ALTER TABLE artists ADD CONSTRAINT artists_status_check CHECK (status IN ('pending', 'active', 'suspended', 'rejected'));

-- ---------------------------------------------------------------- designs
ALTER TABLE designs
  ADD COLUMN IF NOT EXISTS artist_id uuid REFERENCES artists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS includes text NOT NULL DEFAULT '';           -- what the price covers, e.g. "both palms up to the wrist"

CREATE INDEX IF NOT EXISTS designs_artist_idx ON designs(artist_id);
CREATE INDEX IF NOT EXISTS designs_review_idx ON designs(review_status) WHERE review_status <> 'approved';

-- Real photographs of an artist's work for a design (gallery; the first is the cover).
CREATE TABLE IF NOT EXISTS design_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id uuid NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  url text NOT NULL,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS design_photos_design_idx ON design_photos(design_id, sort);

-- ---------------------------------------------------------------- bank & payouts
CREATE TABLE IF NOT EXISTS artist_bank_accounts (
  artist_id uuid PRIMARY KEY REFERENCES artists(id) ON DELETE CASCADE,
  holder_name text NOT NULL,
  account_enc text NOT NULL,                 -- AES-256-GCM ciphertext; never stored in clear
  account_last4 text NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  ifsc text NOT NULL CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name text NOT NULL DEFAULT '',
  upi_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  verified_by uuid REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  amount_paise int NOT NULL CHECK (amount_paise > 0),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'paid', 'rejected')),
  bank_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,   -- masked: holder, last4, ifsc, bank
  reference text,                                     -- bank UTR / transaction reference
  admin_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processed_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS payout_requests_status_idx ON payout_requests(status, requested_at);
CREATE INDEX IF NOT EXISTS payout_requests_artist_idx ON payout_requests(artist_id, requested_at DESC);
-- At most one open request per artist.
CREATE UNIQUE INDEX IF NOT EXISTS payout_requests_one_open_idx ON payout_requests(artist_id) WHERE status IN ('requested', 'approved');

-- Signed money movements for an artist. Balance = sum(amount_paise).
--   booking         +advance collected online − platform margin on the booking total (can be negative)
--   payout          −amount, written when a payout is requested (reserves the money)
--   payout_reversal +amount, when a requested payout is rejected
--   adjustment      ±amount by an admin, with a note
CREATE TABLE IF NOT EXISTS artist_ledger (
  id bigserial PRIMARY KEY,
  artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('booking', 'payout', 'payout_reversal', 'adjustment')),
  amount_paise int NOT NULL,
  booking_id uuid REFERENCES bookings(id),
  payout_id uuid REFERENCES payout_requests(id),
  gross_paise int NOT NULL DEFAULT 0,        -- booking total
  margin_paise int NOT NULL DEFAULT 0,       -- platform margin taken
  advance_paise int NOT NULL DEFAULT 0,      -- collected online by the platform
  cash_paise int NOT NULL DEFAULT 0,         -- balance the artist collected from the customer
  margin_bp int,
  note text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artist_ledger_artist_idx ON artist_ledger(artist_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS artist_ledger_booking_once_idx ON artist_ledger(booking_id) WHERE kind = 'booking';
CREATE UNIQUE INDEX IF NOT EXISTS artist_ledger_payout_kind_idx ON artist_ledger(payout_id, kind) WHERE payout_id IS NOT NULL;

-- ---------------------------------------------------------------- support tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  artist_id uuid REFERENCES artists(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  requester_name text NOT NULL,
  requester_contact text NOT NULL DEFAULT '',
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('booking', 'payment', 'payout', 'account', 'design', 'technical', 'other')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'awaiting_reply', 'resolved', 'closed')),
  booking_code text,
  last_actor text NOT NULL DEFAULT 'artist' CHECK (last_actor IN ('artist', 'admin', 'customer', 'system')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_artist_idx ON support_tickets(artist_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id bigserial PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_type text NOT NULL CHECK (author_type IN ('artist', 'admin', 'customer', 'system')),
  author_id uuid,
  author_name text NOT NULL DEFAULT '',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket_idx ON ticket_messages(ticket_id, created_at);

-- ---------------------------------------------------------------- email delivery log
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS artist_id uuid REFERENCES artists(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check CHECK (status IN ('queued', 'sent', 'failed', 'skipped'));
CREATE INDEX IF NOT EXISTS notifications_artist_idx ON notifications(artist_id, created_at DESC);

-- ---------------------------------------------------------------- access control (see 001)
ALTER TABLE design_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
