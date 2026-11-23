# Implementation status — 2026-11-23 (updated after the second iteration)

## Second iteration (this update)

| Request | Status |
|---|---|
| Realistic hand + real-looking mehndi | **Done.** CC0 MakeHuman hand with an Indian female skin texture, built headless in Blender (`scripts/hand-real/build.sh`); cone-drawn artwork; stain shader; photographic thumbnails. See `docs/HAND_REALISM.md`. |
| Mobile responsiveness | **Done.** Root cause of the broken mobile view: the header's `backdrop-filter` collapsed the phone menu. Plus tap targets, sticky bars, landscape and admin card layouts. No horizontal overflow at 320–768px. |
| Video row (5 links), plays one by one on scroll | **Done.** Sticky row driven by page scroll, swipeable, one player at a time, YouTube auto-advance. The videos belong to other creators (Lashes Beauty Parlour, Naina Goyal Mehandi, Rukaiya Mehendi House, an Instagram reel, Mehndi Designs Collection), so they are credited, not labelled as VAISHORA customers. Config: `src/lib/showcase-videos.ts`. |
| Reviews on the website | **Done (real reviews only).** Customers review completed bookings; admins record reviews genuinely received elsewhere, with a link or evidence note; moderation at `/admin/reviews`. Shows nothing until real reviews exist. |
| 180 Identity sign-in + 180 Pay checkout (their own sheets) | **Built, blocked on 180's side.** Login returns 403 "180 Identity Authentication is disabled for application 'Vaishora'"; 180 Pay checkout was under scheduled maintenance. Enable both in the 180 developer portal, set `NEXT_PUBLIC_180_IDENTITY` (not `off`), `PAYMENT_PROVIDER=180pay`, `ONE_EIGHTY_WEBHOOK_SECRET`. Spec: `docs/integrations/180CORE.md`. |
| Account only at checkout (name, phone, email, gender, address) | **Done.** “My bookings” page at `/account`. Browse and pick a slot freely; checkout asks for sign-in (180) or, while 180 login is off, a one-time guest details form. Bookings require a complete profile server-side. |
| One ad video from the two scripts, aimed at prepaid bookings | **Done.** `marketing/ad/render/vaishora-ad-master-9x16.mp4` (1080×1920, 32 s, 5.2 MB) and `-4x5.mp4` (5.6 MB), with the realistic hand and real site screens; script, analysis and Veo prompt pack in `marketing/ad/`. Rebuild: `python marketing/ad/build/build.py`. Confirm the voice licence and prices before paid use. |
| Push to GitHub | **Done** — `github.com/Prince364133/Vaishora` (`main`). Private research notes and generated ad media are not tracked. Note: an earlier commit (`f11c886`, made by another session) contains `research/reseach.txt` in the public history. |

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
| Realistic hand | Photoreal CC0 hand; skin texture is ~400px across the hand, so extreme close-ups are soft | A commercial hand scan (e.g. V-ARM 03) drops into the same pipeline |
| Payments | 180 Pay (primary, pending 180 enabling it) and Razorpay (fallback) implemented with server-side verification | Live run once 180 Pay is out of maintenance, or Razorpay test keys |
| Notifications | Rows queued on payment (`notifications` table) | WhatsApp Business / SMS provider integration and a sender |
| Policies | Draft terms, privacy, cancellation/refund pages (policy page reads live settings) | Legal review |
| Admin roles | admin and staff | Finer-grained permissions, staff user management UI (create staff via SQL/seed for now) |
| Artist self-registration | Application form → admin inbox → admin creates profile and login | Self-service onboarding with document upload |
| Static fallback | Flat silhouette + artwork | Pre-rendered 3D stills per design for higher-quality fallback/thumbnails |

## Pending

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

- Optional: a commercial high-resolution hand scan for sharper close-ups (current hand is CC0 and photoreal at normal viewing distance).
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
