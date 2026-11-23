# Implementation status — 2026-11-23

## Completed (built and tested)

- **Brand system:** palette tokens per brand spec, Cormorant Garamond + Manrope, emblem/wordmark extracted from the logo,
  favicon, arch-framed hero stage, consistent buttons/inputs/chips/cards, loading/empty/error/success states.
- **Homepage:** hero + interactive design studio sharing one 3D viewer, popular designs, services, how it works, why VAISHORA
  (only implemented claims), artist showcase, testimonials (real published reviews only; labelled samples in dev only), final
  CTA, footer with all required links.
- **3D hand:** smooth hand mesh (HQ/LQ), skin shader, simulated nails, object-space mehndi projection on palm and back, GPU
  crossfade on design change, rotate/tilt/zoom/reset/palm/back, touch-friendly scrolling behaviour, lazy loading, quality
  tiers, demand rendering, texture cache with disposal, WebGL fallback.
- **Design library:** 11 original designs across 11 categories, generated from an original motif library aligned to the hand
  landmarks; catalogue with search, category filter, sort; design detail pages.
- **Pricing:** configurable rules (hands, side, coverage, add-ons, extra people), coupons, booking fee, GST toggle, advance %;
  server-side quotes; itemised summary; prices never trusted from the browser.
- **Booking flow (5 steps + payment + confirmation):** service details, address with validation, IST date/slot picker driven
  by real artist availability, summary with policy acceptance, idempotent booking creation, unpaid hold with countdown.
- **Scheduling engine:** artist hours, time off, service areas, specialties, skill level, existing bookings, travel buffer,
  lead time, booking window; double booking prevented by advisory lock + Postgres exclusion constraint (tested concurrently).
- **Payments:** Razorpay order creation, checkout, signature verification, payment fetch/capture, amount checks, idempotent
  application, webhooks (signature on raw body, event dedupe), failed/pending handling, refunds (crash-safe), late-payment
  handling; dev-only mock gateway that cannot run in production.
- **Booking page:** status, next step, itemised payment summary, payment status, refunds, support links, customer
  cancellation with policy-based refund, find-my-booking by ID + phone.
- **State machine:** 11 statuses with enforced transitions and full history with actors.
- **Admin:** role-protected login (admin/staff), dashboard metrics, bookings list/search/filter, booking detail (assign/
  reassign with busy detection, status changes, refunds, call/WhatsApp), designs (create/edit, artwork upload, pricing,
  duration, eligibility, availability), categories, artists (profile, verification, specialties, service areas, weekly hours,
  time off, photo/portfolio upload, portal login), pricing rules, business settings, coupons, customers, support inbox, artist
  applications, audit log.
- **Artist portal:** assigned bookings; accept/decline/start/complete; address and phone revealed only after acceptance.
- **Security:** see `PROJECT_ARCHITECTURE.md` (sessions, roles in every action, RLS lockout, validation, rate limits,
  honeypots, upload sniffing, audit, security headers).
- **Docs & tooling:** research, stack, 3D, UI/UX, architecture, deployment, QA; migrations; seed; `.env.example`; tests;
  4 installed skills with attribution.

## Partially completed

| Item | State | What is missing |
|---|---|---|
| Realistic hand | Smooth, well-proportioned stylised hand with shader skin and nails | Photoreal licensed model with skin textures (see “Assets still needed”) |
| Razorpay | Fully implemented to documented spec, unit/integration tested via the same verification path | Live test-mode run with real keys and webhooks |
| Reviews | Schema, display (only published, only from bookings), artist rating aggregation | Customer review submission form after completion + admin moderation screen |
| Notifications | Rows queued on payment (`notifications` table) | WhatsApp Business / SMS provider integration and a sender |
| Policies | Draft terms, privacy, cancellation/refund pages (policy page reads live settings) | Legal review |
| Admin roles | admin and staff | Finer-grained permissions, staff user management UI (create staff via SQL/seed for now) |
| Artist self-registration | Application form → admin inbox → admin creates profile and login | Self-service onboarding with document upload |
| Static fallback | Flat silhouette + artwork | Pre-rendered 3D stills per design for higher-quality fallback/thumbnails |

## Pending

- Customer OTP login / booking history across bookings (customers currently use private links or ID + phone).
- Rescheduling flow (today: cancel + rebook or admin handles).
- Razorpay Route / automated artist payouts and commission accounting.
- GST invoices / receipts (PDF) once tax treatment is confirmed.
- Analytics and error monitoring (e.g. Sentry), uptime checks.
- Distributed rate limiting for multi-instance hosting.

## External credentials required

| Credential | Used for |
|---|---|
| `APP_SECRET` | Customer booking links (mandatory in production) |
| `DATABASE_URL` (Supabase Postgres) | Production database |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` + public bucket | Admin uploads in production |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Payments, refunds, webhooks |
| Support phone / WhatsApp / email, Instagram URL | Contact links (env or admin settings) |
| (future) WhatsApp Business API / SMS provider | Booking notifications |

## Assets still needed

- **Licensed photoreal female hand GLB** (e.g. V-ARM 02, ≈US$35 standard licence — confirm web redistribution rights).
- Real artist photos and portfolio images (with artists’ consent).
- Optional: commissioned mehndi artwork from VAISHORA artists (upload as transparent PNG via admin).
- Brand: an SVG version of the logo (current marks are extracted from the PNG).
- Real customer reviews (collected after completed bookings).

## Known bugs / limitations

- No physical-device testing yet (iOS Safari especially); pinch/drag verified only in emulation.
- `three` logs a `THREE.Clock` deprecation warning from R3F 9.8 (harmless, upstream).
- In development only one `next dev` per folder; use `NEXT_DIST_DIR` for a second instance.
- Partial refunds move the booking to “Refunded” (meaning the refund owed is complete), not a separate “partially refunded”
  booking status; the payment row records `partially_refunded`.

## Recommended next steps

1. Get Razorpay test keys and run the staging smoke test in `DEPLOYMENT.md`.
2. Onboard 3–5 real artists in one zone (e.g. Gachibowli–Kondapur–Madhapur) and switch off demo artists.
3. Buy/licence the photoreal hand and re-run the asset scripts.
4. Legal/CA review of policies, GST and marketplace payment flow.
5. Test on 3–4 real phones (low-end Android, mid Android, iPhone) and tune the quality tiers.
6. Add WhatsApp notifications for booking paid / artist confirmed / reminder.
7. Add review collection after completed bookings.
