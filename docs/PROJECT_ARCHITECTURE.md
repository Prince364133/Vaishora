# Project architecture

## Directory map

```
db/migrations/001_init.sql        schema, constraints, indexes, RLS
scripts/                          seed, migrate, hand asset build, artwork generator, screenshot helpers
src/app/(site)/                   public site: home, designs, design detail, book flow, booking page, artists, policies…
src/app/admin/                    login, server actions, (panel)/ dashboard, bookings, designs, artists, pricing, customers
src/app/artist-portal/            artist-only view of assigned bookings
src/app/api/                      quote, slots, bookings (+cancel, find), payments (order, verify, mock), webhooks/razorpay, support, artist-applications
src/components/hand/              3D viewer, shader material, static illustration
src/components/studio/            design studio, cards, catalogue
src/components/booking/           booking flow, payment panel, cancel
src/components/admin|site|home|artists/
src/lib/                          shared, framework-free: pricing engine, booking state machine, IST time, money, Zod schemas, mehndi artwork generator
src/server/                       server-only: db adapter, auth, bookings, availability, catalog, settings, payments, storage, rate limit, http helpers
tests/unit, tests/integration     Vitest (integration runs the real migrations on in-memory PGlite)
tests/e2e                         Playwright (Python) journeys
```

## Data model (main entities)

```
users ─┬─ sessions                         design_categories ─< designs ─< design_assets
       └─ artists ─┬─< artist_services >── design_categories
                   ├─< artist_service_areas >── localities
                   ├─< artist_availability (weekday, IST minutes)
                   ├─< artist_time_off (tstzrange)
                   └─< artist_portfolios
customers ─< bookings >── designs, artists?, localities, coupons?
bookings ─< booking_items, booking_status_history, payments ─< refunds, notifications; reviews (1:1, completed only)
payment_events (webhook idempotency) · pricing_rules · settings (jsonb) · coupons · artist_applications · support_requests · audit_logs
```

All money is integer paise; all timestamps are `timestamptz` in UTC; IST is applied in `src/lib/time.ts` (fixed +05:30 — India
has no DST).

## Booking lifecycle

```
                    ┌────────── expired (hold lapsed) ──┐ (late payment revives if slot still free)
                    │                                    ▼
create ─► pending_payment ──verified payment──► paid ──► awaiting_artist_confirmation ──artist/admin accept──► confirmed ─► in_progress ─► completed
                    │                             │            │  ▲  artist declines / reassigned              │
                    └──► cancelled                └────► awaiting_artist_assignment ◄─────────────────────────┘
any paid, not-started state ──► refund_pending ──► refunded        (state machine: src/lib/booking-status.ts)
```

- Every change goes through `transitionBooking` (row lock + state-machine check) and is written to `booking_status_history`
  with the actor (system / customer / admin / artist / webhook).
- A booking is shown to the customer as “Confirmed” only after the artist (or an admin on their behalf) accepts. The artist’s
  name appears only then.

## Availability and double-booking prevention

1. `computeDaySlots` (`src/server/availability.ts`) builds candidate starts every N minutes within service hours. A slot is
   offered only if at least one artist is: active (demo artists only when enabled), serving the locality, offering the
   category, at or above the design’s skill level, working that weekday for the whole service window, not on time off, and
   free for the **block** = service time ± travel/prep buffer. Lead time and booking window are enforced. Only availability is
   returned to the browser, never artist identities.
2. `createBooking` takes a transaction-scoped advisory lock, expires stale holds, re-computes availability for the requested
   slot, picks the least-loaded free artist, and inserts the booking with `status = pending_payment` and a hold expiry.
3. **The database is the final guard:** `EXCLUDE USING gist (artist_id WITH =, block WITH &&)` for active statuses. Two
   overlapping active bookings for one artist cannot exist, even if application logic were bypassed. Violations surface as
   “that time was just taken”. Verified by concurrent-request tests.
4. Unpaid holds expire after `hold_minutes` and release the slot.

## Pricing

`computeQuote` (`src/lib/pricing.ts`, pure function) uses the design’s base price and duration, admin-configured
`pricing_rules` (hands / side / coverage multipliers and flats, add-ons, additional-person factor), coupons, booking fee, GST
toggle and advance %. The browser only displays quotes from `/api/quote`; the booking endpoint recomputes the quote from the
database at creation time and stores the itemised lines — client-supplied prices are never used.

## Payments

```
browser                         server                                    Razorpay
  │ Pay ───────────────► POST /api/payments/order ── create order ──────────►│
  │◄─ key, order_id ─────────────│ (reuses an open order for the same amount) │
  │ Razorpay Checkout ───────────────────────────────────────────────────────►│
  │◄─ order_id, payment_id, signature                                         │
  │ ──────────────────► POST /api/payments/verify                              │
  │                       verify HMAC(order|payment, key secret)               │
  │                       fetch payment ◄──────────────────────────────────────│ (capture if authorized)
  │                       check order + amount + currency, applyPayment (idempotent)
  │◄─ outcome ────────────│
                         POST /api/webhooks/razorpay ◄── signed raw body ───────│ payment.captured / failed, order.paid, refund.*
                          verify HMAC(raw body, webhook secret), dedupe by event id, applyPayment / refund update
```

- `applyPayment` is idempotent (row locks, status checks) so callback and webhook can arrive in any order or repeatedly.
- Amount mismatches are refused and flagged. Late payments for expired holds revive the booking if the artist is still free,
  otherwise send it to manual assignment.
- Refunds: the refund row is committed (pending) **before** calling the gateway, then updated with the gateway result and
  again by the refund webhooks — a gateway refund can never exist without a record.
- No card/UPI data touches the server; only order/payment IDs and statuses are stored.
- The mock provider is selectable only when `PAYMENT_PROVIDER=mock` **and** `NODE_ENV !== "production"`; its route returns
  404 otherwise (verified on a production build).

## Security model

| Concern | Implementation |
|---|---|
| Admin/staff/artist auth | scrypt hashes; 32-byte random session token, only its SHA-256 stored; httpOnly, SameSite=Lax, Secure in production; 7-day expiry; login rate-limited (8 / 15 min / IP); password change revokes sessions |
| Authorisation | `requireRole` in every admin page and **inside every server action**; refunds, pricing, designs, artist verification are admin-only; staff can manage bookings and inbox; artists can act only on bookings assigned to them and see full address/phone only after accepting |
| Customer data isolation | No customer accounts; booking page needs a 43-char HMAC token (`APP_SECRET`) or booking ID + phone (rate-limited 8 / 15 min). Tokens are not stored in clear |
| Database exposure | Server-only DB access; RLS enabled with no policies on every table, so Supabase anon/authenticated APIs see nothing |
| Input validation | Zod on every endpoint and action; body size limits; parameterised SQL only |
| Abuse | Per-IP rate limits on quote, slots, booking, payment, cancel, find, support, apply; honeypot fields on public forms. The client IP is read from `X-Forwarded-For`, which is only trustworthy behind a proxy that overwrites it (Vercel, Cloudflare, a configured nginx). On a bare server, take the IP from the socket instead or the limits can be bypassed |
| Uploads | Magic-byte sniffing (PNG/WebP/JPEG only, SVG refused), 3 MB limit, random names |
| Payments | See above; signature + API fetch + amount check; webhook signature over raw body; idempotency tables |
| Audit | `audit_logs` for logins, status changes, assignments, refunds, design/price/settings/coupon/artist changes |
| Headers | nosniff, Referrer-Policy, X-Frame-Options SAMEORIGIN, Permissions-Policy |

## Rendering and caching

Catalogue reads (`src/server/cached.ts`) use `"use cache"` with tags `catalog`/`artists`; admin actions call `updateTag` so
price changes appear immediately (verified). Money that is charged is always computed from uncached database reads. Request-
specific pages (booking page, admin) stream inside `<Suspense>` after `connection()`.

## Scaling notes

- The in-memory rate limiter and the advisory-lock approach assume one region; for multiple instances use Redis/Upstash for
  rate limits (the DB lock and exclusion constraint already work across instances).
- `notifications` rows are queued but not delivered — a WhatsApp Business/SMS provider and a worker are needed.
