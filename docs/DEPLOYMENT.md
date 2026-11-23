# Setup and deployment

## Local development

Requirements: Node 20+ (tested on Node 24), pnpm 10+. No Docker or database server needed.

```bash
pnpm install
cp .env.example .env.local          # PAYMENT_PROVIDER=mock is fine locally
pnpm db:seed -- --demo              # creates .data/pglite, catalogue, admin user (password printed), DEMO artists
pnpm dev                            # http://localhost:3000
```

- Admin: `/admin/login` with the printed credentials (or set `ADMIN_EMAIL`/`ADMIN_PASSWORD` before seeding).
- With `PAYMENT_PROVIDER=mock`, the booking page shows a clearly marked “Test payment gateway (development only)” panel.
- Demo artists are flagged `is_demo`, labelled “Sample profile” everywhere, and hidden in production unless an admin turns on
  *Show demo artists* (keep it off for a real launch).
- Rebuild the realistic hand (portable Blender + CC0 MakeHuman assets): `bash scripts/hand-real/build.sh` — see
  `docs/HAND_REALISM.md`. Regenerate mehndi artwork after changing the generator: `pnpm artwork:generate`.
- The embedded dev database can't be opened by two processes: run `next build` with a separate `PGLITE_DIR` while `next dev` is running.
- Only one `next dev` may run per project folder. To run a second isolated instance, use `NEXT_DIST_DIR=.next-alt`.

## Tests

```bash
pnpm test                            # Vitest: unit + integration (real migrations on in-memory Postgres)
pnpm typecheck && pnpm lint
# E2E (Python Playwright; dev server with PAYMENT_PROVIDER=mock and demo artists)
python tests/e2e/booking_flow.py http://localhost:3000 390
python tests/e2e/webgl_fallback.py http://localhost:3000
# Production-mode QA (next build && next start, separate PGLITE_DIR, APP_SECRET set)
python tests/e2e/production_qa.py http://localhost:3003 admin@vaishora.local <password>
python tests/e2e/perf.py http://localhost:3003
```

## Production (recommended: Vercel + Supabase)

1. **Supabase project** (region: Mumbai `ap-south-1` for Hyderabad latency).
   - Copy the Postgres connection string to `DATABASE_URL`.
   - Storage → create a **public** bucket `public-assets`; set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server-only).
   - Nothing else: the app does not use Supabase Auth or the REST API; RLS is enabled with no policies so those APIs expose nothing.
2. **Migrate and seed** from your machine or CI, pointing at production:
   ```bash
   DATABASE_URL=... pnpm db:migrate
   DATABASE_URL=... ADMIN_EMAIL=you@yourdomain ADMIN_PASSWORD='<strong password>' pnpm db:seed   # no --demo
   ```
3. **Razorpay**
   - Complete KYC; get live keys (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`). Use test keys on a staging deployment first.
   - Enable **automatic capture** for payments (Dashboard → Settings → Payment capture). The server also captures `authorized`
     payments during verification as a safety net.
   - Webhook: `https://<domain>/api/webhooks/razorpay`, a new secret → `RAZORPAY_WEBHOOK_SECRET`, events
     `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.
   - Set `PAYMENT_PROVIDER=razorpay`.
4. **Vercel** — import the repo; set env vars from `.env.example` (`APP_SECRET` is mandatory); build command `pnpm build`.
   Region `bom1` (Mumbai) to sit next to Supabase. Add your domain and set `NEXT_PUBLIC_SITE_URL`.
5. **After first deploy**
   - Log in at `/admin`, change the admin password, set support phone/WhatsApp/email and hours under Pricing & settings.
   - Review package multipliers, advance %, buffer, lead time, cancellation windows; leave GST off until your CA confirms.
   - Add real artists (Artists → Add artist): specialties, service areas, weekly hours; mark verified only after checks; create
     artist logins. Customers see time slots only once at least one active artist covers their area.
   - Replace draft policy pages after legal review (`src/app/(site)/terms|privacy|cancellation-refund`).
6. **Smoke test with Razorpay test keys** on staging: successful UPI/card payment, failed payment, webhook delivery (Dashboard →
   Webhooks → logs), refund from admin, `refund.processed` webhook → booking shows “Refunded”.

### Notes for other hosts

- Any Node host works (`pnpm build && pnpm start`). On a single persistent server you may run without Supabase Storage by
  setting `ALLOW_LOCAL_UPLOADS=1`.
- Multiple instances: replace the in-memory rate limiter (`src/server/rate-limit.ts`) with Redis/Upstash.
- The build prerenders catalogue pages using the database — make sure `DATABASE_URL` is available at build time, or the build
  will use an empty local PGlite database.
