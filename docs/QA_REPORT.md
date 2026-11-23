# QA report — 2026-11-23

Environment: Windows 11, Node 24, Chromium (Playwright 1.65) with hardware GPU (ANGLE D3D11) and device emulation;
production checks on `next build && next start` with an isolated database. **Not tested on physical phones or Safari/iOS.**

## Second iteration — results (2026-11-23)

- Vitest: **31/31** (adds 180 webhook signature tests; integration tests now book as signed-in customers).
- `tsc`, ESLint: clean. Production build: 46/46 pages.
- E2E booking (390px): browse without account → when & where → guest details → pay (mock) fail → retry → success →
  “Awaiting artist confirmation”. ✅
- E2E production QA: no fake availability, admin price change live, honest “payment not configured”, admin pages,
  all public pages 200 with no overflow at 390px. ✅
- No-WebGL fallback with the new photographic hand. ✅
- Video row: each scroll step mounts exactly one player in order; no overflow. ✅
- Mobile sweep (agent): no horizontal overflow at 320/360/375/390/412/430/768 and 844×390 landscape.
- 180 Identity / 180 Pay: **not testable live** — login disabled for the app (403), checkout in maintenance.
- Known: running `next build` while `next dev` holds the embedded dev database aborts prerendering; use a separate `PGLITE_DIR`.

## Automated tests

| Suite | Result |
|---|---|
| Vitest unit — pricing engine (8), state machine + IST time (8) | ✅ pass |
| Vitest integration on real migrations / in-memory Postgres (13) | ✅ pass — 29/29 total |
| `tsc --noEmit` | ✅ clean |
| ESLint (Next + React Compiler rules) | ✅ clean (one scoped, documented exception for imperative three.js mutation in `HandScene.tsx`) |
| `next build` | ✅ all routes static or partial-prerender |

Integration coverage: slot generation within artist hours; **three simultaneous requests for one artist → exactly one booking,
two “slot taken”**; travel buffer blocking; idempotent retries; DB exclusion constraint rejects a direct overlapping insert;
stale holds expire and release slots; forged payment signature rejected; successful verification → awaiting artist
confirmation; webhook replay is a no-op; failed payment leaves booking pending; amount mismatch refused; illegal state skip
refused; partial refund settles booking and payment; over-refund refused; unpaid cancellation; late payment after expiry
(keeps slot if free / manual assignment if taken).

## End-to-end journeys (Playwright)

| Journey | Viewport | Result |
|---|---|---|
| Book Classic Mandala: both hands + feet + 2 people → server price ₹4,025 (verified by hand), validation errors, locality, date, 14/18 slots available, policy required, booking created, **failed payment → retry → success**, status “Awaiting artist confirmation” | 390×844 mobile | ✅ |
| No WebGL (`--disable-webgl`): static hand preview, design switching updates preview and details, booking link correct | 390×844 | ✅ |
| Production: no demo artists → “No artist is available” (no fake availability) | 390 | ✅ |
| Production: admin login (wrong password rejected, rate limit triggers after 8 attempts), edit design price → ₹549 live on site immediately | 1280 | ✅ |
| Production: payment without gateway credentials → honest “not configured” message, booking remains pending, mock route returns 404 | 390 | ✅ |
| Production: all admin pages render; all public pages return 200 with no horizontal overflow at 390px; unknown URL → 404 | | ✅ |
| Admin (dev): fresh paid booking → admin confirms → customer page shows Confirmed → admin issues full refund → admin and customer both show Refunded | 1280 + 390 | ✅ (refund initially **failed** — bug 6 below — fixed and re-verified) |

## 3D checks

| Check | Result |
|---|---|
| Hand loads (HQ on desktop, LQ on mobile) | ✅ screenshots in `scripts/out/` during development |
| Palm and back views, mehndi follows the surface, fades on finger sides | ✅ visually verified (Minimal Arabic Trail palm, Royal Bridal palm + back) |
| Design switching crossfades without recreating the scene | ✅ |
| Zoom/rotate/reset controls | ✅ buttons exercised; pinch and drag not tested on real touch hardware |
| Texture memory | LRU cache of 8 with disposal on eviction; not profiled on a device |

## Performance (production build, localhost — network not throttled)

| Metric | Desktop 1366 | Mobile 390, 4× CPU slowdown |
|---|---|---|
| FCP | 320 ms | 464 ms |
| LCP | 916 ms | 464 ms |
| CLS | 0.0007 | 0.0185 |
| JS transferred (incl. lazily loaded three/R3F) | 440 KB | 440 KB |
| Hand model | hand-hq.glb 562 KB, loaded by 1.38 s | hand-lq.glb 141 KB, loaded by 1.82 s |
| Total transfer | 1.28 MB | 0.85 MB |

Targets for launch (to be measured on a real 4G Android mid-range device): LCP < 2.5 s, CLS < 0.1, INP < 200 ms, 3D interactive
< 4 s. The page is usable before the 3D loads (static preview + CTAs).

## Bugs found and fixed during QA

1. Runtime subdivision (three-subdivide) froze the page for seconds and produced faceted, cracked geometry → replaced with an
   offline Loop-subdivision build step.
2. Mobile horizontal overflow (1648 px) on the homepage → grid track `minmax(0,1fr)`.
3. Viewer collapsed when positioned absolutely → className conflict fixed.
4. Prerender errors (`Date.now()`/`usePathname` outside Suspense) on several routes → `connection()` / removed hook.
5. Login form cleared the email after a failed attempt (React 19 form reset) → email preserved.
6. **Refund settlement SQL error** that rolled back the refund after the gateway call → query fixed; refunds now committed as
   pending before calling the gateway.
7. **Late-payment revival** would have hit the overlap constraint before its savepoint → restructured and tested.
8. Base CSS outside `@layer` overrode Tailwind utilities (admin headings) → moved into `@layer base`.

## Not tested / known gaps

- Physical iOS/Android devices, Safari, Firefox; real touch gestures; mobile GPU memory.
- Real Razorpay test-mode payments and webhooks (no credentials available). Code follows the documented signature schemes;
  it must be smoke-tested on staging with test keys before launch.
- Supabase Storage uploads (no credentials); local upload path tested only via code review.
- Accessibility: semantics reviewed in code and via Playwright role queries; no screen-reader or automated axe audit yet.
