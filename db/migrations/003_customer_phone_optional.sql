-- A customer who signs in with email-only 180 Identity has no phone until they complete the
-- quick checkout profile. Bookings still require a complete profile (enforced in the app).
ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE customers ALTER COLUMN name SET DEFAULT '';
CREATE UNIQUE INDEX customers_email_lower_idx ON customers (lower(email)) WHERE email IS NOT NULL AND identity_sub IS NOT NULL;
