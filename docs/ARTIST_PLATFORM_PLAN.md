# Artist platform — audit, additions and implementation plan

Date: 2026-11-25. Scope: artist onboarding → verification → artist portal (dashboard, orders, designs,
profile, schedule, payouts, support) and the matching admin panel (verification, payouts & margins,
artists, customers, support).

## 1. Audit of the brief

| # | Finding | Decision |
|---|---------|----------|
| A1 | 180 Identity today offers Google / LinkedIn / GitHub / email sign-in (phone is disabled, see `docs/integrations/180CORE.md`). | Artists are matched to their application by the **verified email** from 180 Identity. The application form makes email mandatory and says “sign in later with this email”. |
| A2 | Two account systems exist: staff/admin (`users` + password) and customers (`customers` + 180). | Artists reuse the staff session (`users.role = 'artist'`, `sessions`), but the session is started by 180 Identity, not a password. Admin password login is unchanged. One “Sign in” button routes by role: artist email → artist portal, everyone else → customer account. |
| A3 | Customers pay only the **advance** online; the balance is paid to the artist in cash after the session. | Payouts are computed from an **earnings ledger**: on completion the artist is credited `advance collected − platform margin on the total`. If the margin is larger than the advance, the entry is negative (the artist owes the platform), and the balance shows it. |
| A4 | Designs today are platform-owned and artists are auto-assigned by availability. | Designs get an optional owner (`designs.artist_id`). Booking an artist’s design books **that artist** (their schedule, service areas and duration). Platform designs keep auto-assignment. |
| A5 | Designs already have `duration_minutes`; pricing options (both hands, people…) scale duration. | The artist’s duration is the base duration, so slots are always sized correctly for the selected options. |
| A6 | Availability already reads `artist_availability` (weekday windows) and `artist_time_off`. | The artist schedule editor writes exactly these tables, so slots shown to customers follow it with no extra logic. |
| A7 | An artist only appears in slot search when they have service areas, specialties **and** hours. A “verified” artist without these silently never gets bookings. | The onboarding checklist makes these explicit, and the dashboard warns when the artist is not bookable yet. |
| A8 | Hard-coded data: `artist-portal/page.tsx` links any artist login to “Demo Artist A” and inserts a fake booking; `db.ts` creates a demo artist login automatically. | Removed. Demo catalogue seed stays only behind `pnpm db:seed` / local auto-seed, flagged `is_demo` and hidden in production (`allow_demo_artists`). |
| A9 | Bank details are sensitive. There is no payout API, so payouts are made manually. | Account numbers are encrypted at rest (AES-256-GCM, key derived from `APP_SECRET`), shown masked, and changing them emails the artist. Admin marks a payout paid with the bank reference (UTR). |
| A10 | Email: there is no mailer. `.env.local` points at the live database with auto-migrate on. | SMTP via `nodemailer`, configured by `SMTP_*` env vars; every email is logged in `notifications` and failures never break a request. Migration `005` is add-only (no drops/rewrites), so it is safe on the live database. |

## 2. Ten additions (accepted and built)

1. **Onboarding checklist** after approval: profile photo & bio → service areas & specialties → working hours → bank account → first design, with progress on the dashboard.
2. **Time off / blocked dates** and a **max bookings per day** cap, so artists can block weddings, festivals and holidays.
3. **Earnings ledger** (immutable entries) with a **minimum payout amount** and a payout **request → approve → paid / reject** workflow; a pending request reserves its amount.
4. **Design moderation with reasons**: approve / reject with a note; rejected designs can be edited and resubmitted; editing an approved design’s price or photos sends it back to review.
5. **Email notifications** for: application received, artist approved / rejected, design approved / rejected, new booking request, payout paid / rejected, ticket reply, bank details changed.
6. **Two-way support tickets**: a thread of messages, categories, priority, optional booking reference, status (open → in progress → resolved → closed); the artist can reply or reopen.
7. **Per-artist margin override** on top of the central platform margin (e.g. promotional rate for a top artist), recorded in the audit log.
8. **Bookable status**: an artist is public and bookable only when approved, active and complete (areas + specialties + hours). Suspension hides them immediately.
9. **Bank change protection**: encrypted, masked, email alert on change, and admin sees “changed recently” before paying.
10. **Artist booking actions** with privacy: accept / decline (declined bookings go back to admin for reassignment), start, complete; customer phone and full address appear only after the artist accepts.

## 3. Architecture

- **Database** (`db/migrations/005_artist_platform.sql`): artist application & profile columns, `rejected` status, margin override, daily cap; `designs.artist_id` + review columns; `design_photos`; `artist_bank_accounts`; `artist_ledger`; `payout_requests`; `support_tickets` + `ticket_messages`; email delivery columns on `notifications`; settings `platform_margin_bp`, `payout_min_paise`.
- **Server modules**: `server/artist-auth.ts` (180 sign-in → artist session, `requireArtist`), `server/artist-portal.ts` (profile, schedule, designs, orders, dashboard), `server/ledger.ts` (earnings and payouts), `server/support.ts` (tickets), `server/email.ts` (SMTP + templates), `server/vault.ts` (encryption). Mutations are server actions in `app/artist-portal/actions.ts` and `app/admin/actions.ts`, validated with zod and audit-logged.
- **Booking integration**: `computeDaySlots` takes an optional `artistId` (the design owner) and respects the daily cap; `transitionBooking` writes the ledger entry when a booking is completed (same transaction).
- **UI**: artist portal is mobile-first with a bottom tab bar (Home, Orders, Designs, Profile); Payouts, Schedule and Support are reached from Home and Profile. The admin panel gains Verification, Payouts & margins and Support pages, and an extended Dashboard.

## 4. Environment

```
SMTP_HOST=            # e.g. smtp.gmail.com / smtp.zoho.in / email-smtp.ap-south-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="VAISHORA <no-reply@your-domain>"
NEXT_PUBLIC_SUPPORT_PHONE=+916205170591
ALLOW_DEV_LOGIN=      # "1" enables the local-only email sign-in for artists when 180 Identity is unavailable (never in production)
```

## 5. Round 2 (2026-11-25) — status

| Requirement | Status | Where |
|---|---|---|
| One sign-in on the website (180 Identity); artists routed to their portal, sign-out returns to the website | Done | `/account` (`AccountAuthCard`), `/api/auth/180`, `/artist-portal/login` → redirect |
| Artists sign up with the form; approval email ("you're now official") | Done | `/become-an-artist`, `reviewArtistAction` |
| Every new design **and every edit** reviewed; live version keeps selling during an edit review | Done | `server/design-revisions.ts`, migration 007, Admin → Verification (shows what changed) |
| Artist can take a design live / unlive any time | Done | design page "Hide (unlive)" / "Make live" |
| Public profile tabs: Mehndi designs (bookable) / Portfolio | Done | `components/artists/ProfileTabs.tsx` |
| Design media: Photos / 3D switch; one YouTube video, autoplays muted, cannot be paused, unmute button | Done | `components/studio/DesignMedia.tsx` |
| Artist 3D preview from their photo (auto hand detection; manual points when henna hides the hand) | Done | `components/artist/DesignMediaFields.tsx`, `lib/photo-import/detect.ts` |
| Adaptive skeleton — one file per app, route-aware, responsive; every page, navigation and tab switch | Done | `components/{site,artist,admin}/AdaptiveSkeleton.tsx`, `loading.tsx` ×3, `KeyedSuspense` |
| Lazy loading | Done | 3D viewer via `next/dynamic` (`LazyHandViewer3D`), YouTube player on view, below-fold images `loading="lazy"` |
| SEO: per-page titles/descriptions/canonicals, share cards, JSON-LD (BeautySalon, WebSite, Product+Offer+Video, BreadcrumbList, ProfessionalService), image+video sitemap, robots | Done | `app/sitemap.ts`, `app/robots.ts`, `app/opengraph-image.tsx`, `server/seo.ts` |
| Side menu navigation on desktop (admin, artist portal) | Done | admin and artist layouts |
| SMTP (Gmail) | Done — login verified | `.env.local`, `server/email.ts` (`EMAIL_FROM`, `SMTP_SECURE` supported) |
| Team alerts (new application, design to review, payout request, ticket) | Added | `notifyTeam()` |
| Homepage videos from artists' own approved designs (curated list only as fallback) | Added | `app/(site)/page.tsx` |

## 6. Round 3 (2026-11-25)

| Requirement | Status | Where |
|---|---|---|
| "Services" removed from header and footer | Done | `components/site/Header.tsx`, `Footer.tsx` |
| Logo never clipped at the top (notch / safe area) | Done | site, artist and admin headers reserve `env(safe-area-inset-top)`; fixed logo size |
| Cover image for artist designs (card image, first photo) | Done | design form "Cover image" + "Cover" choice on existing photos |
| Website mobile bottom navigation: Home, Designs, Artists, Log in / name | Done | `components/site/SiteTabBar.tsx` (hidden from md up and during checkout) |
| Customer account: bookings (upcoming / past, search), addresses, support tickets, profile | Done | `/account`, `/account/addresses`, `/account/support`, `/account/profile` |
| Customer tickets reach admin Support; admin replies emailed to the customer | Done | `server/support.ts`, `adminReplyTicketAction` |
| Multiple saved addresses; choose one at booking; add new via a location search page (Google Maps), then flat / building / landmark | Done | `components/address/AddressPicker.tsx`, `AddressBook.tsx`, migration 008 |
| Real Hyderabad localities from Google Maps | Done | addresses matched to localities by Google area name / nearest; new areas created from Google data; artists add any area via Google search; admin "Sync with Google Maps" |
| Precise artist directions | Done | bookings store coordinates; "Directions in Google Maps" in artist orders |
