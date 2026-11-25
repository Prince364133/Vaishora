-- Ask customers to rate their artist once the booked time is over (email + in-app), remembering a skip.
-- Add-only.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS review_requested_at timestamptz,   -- "rate your artist" email sent
  ADD COLUMN IF NOT EXISTS review_skipped_at timestamptz;     -- customer chose to skip; never asked again

-- Finds bookings whose review request is due.
CREATE INDEX IF NOT EXISTS bookings_review_due_idx ON bookings(ends_at) WHERE review_requested_at IS NULL AND review_skipped_at IS NULL;
