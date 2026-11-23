-- Customer accounts (via 180 Identity), richer customer profile, real reviews, 180 Pay provider.

-- ---------------------------------------------------------------- customer accounts
ALTER TABLE customers
  ADD COLUMN identity_sub text UNIQUE,                     -- subject id from 180 Identity
  ADD COLUMN gender text CHECK (gender IN ('female', 'male', 'non_binary', 'prefer_not_to_say')),
  ADD COLUMN address_line text,
  ADD COLUMN locality_id int REFERENCES localities(id),
  ADD COLUMN landmark text,
  ADD COLUMN profile_completed_at timestamptz,
  ADD COLUMN last_login_at timestamptz;

CREATE TABLE customer_sessions (
  id text PRIMARY KEY,                                      -- sha256 of the session token
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_sessions_customer_idx ON customer_sessions(customer_id);
ALTER TABLE customer_sessions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- reviews
-- Two honest sources only: a customer reviewing their own completed booking, or an admin
-- recording a review the business genuinely received elsewhere (with a link/evidence).
ALTER TABLE reviews
  ALTER COLUMN booking_id DROP NOT NULL,
  ALTER COLUMN customer_id DROP NOT NULL,
  ADD COLUMN source text NOT NULL DEFAULT 'booking' CHECK (source IN ('booking', 'google', 'whatsapp', 'instagram', 'facebook', 'other')),
  ADD COLUMN reviewer_name text,
  ADD COLUMN source_url text,
  ADD COLUMN evidence_note text,
  ADD COLUMN added_by uuid REFERENCES users(id),
  ADD COLUMN reviewed_on date,
  ADD COLUMN moderated_by uuid REFERENCES users(id),
  ADD COLUMN moderated_at timestamptz,
  ADD CONSTRAINT reviews_source_consistency CHECK (
    (source = 'booking' AND booking_id IS NOT NULL AND customer_id IS NOT NULL)
    OR (source <> 'booking' AND reviewer_name IS NOT NULL AND (source_url IS NOT NULL OR evidence_note IS NOT NULL))
  );
CREATE INDEX reviews_status_idx ON reviews(status, created_at DESC);

-- ---------------------------------------------------------------- 180 Pay
ALTER TABLE payments DROP CONSTRAINT payments_provider_check;
ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider IN ('razorpay', 'mock', '180pay'));
