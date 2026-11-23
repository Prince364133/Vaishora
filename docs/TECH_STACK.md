# Tech stack

| Layer | Choice | Version | Why |
|---|---|---|---|
| Framework | Next.js (App Router, Turbopack, **Cache Components + Partial Prefetching**) | 16.4 | Server components keep the catalogue static and fast; route handlers + server actions cover the API and admin; one deployable unit. Cache Components are the framework’s default in 16 and give a static shell with streamed dynamic parts. |
| UI | React | 19.3 | Required by Next 16 / R3F 9. |
| Language | TypeScript (strict) | 5.x | |
| Styling | Tailwind CSS v4 with CSS-first tokens (`@theme` in `globals.css`) | 4.3 | Brand tokens in one place; no runtime CSS-in-JS. |
| 3D | three.js, @react-three/fiber, @react-three/drei | r187 / 9.8 / 10.7 | Industry standard for WebGL in React; drei supplies `useGLTF`, `OrbitControls`, `Environment`/`Lightformer`. |
| Validation | Zod | 4.x | Shared request schemas, server-side validation everywhere. |
| Database | **PostgreSQL** (production, e.g. Supabase) / **PGlite** (local + tests) | PG 15+ / PGlite 0.5 | Real Postgres features are central: `tstzrange` + `EXCLUDE USING gist` makes double-booking impossible at the database level, advisory locks serialise booking creation, row-level security locks out Supabase’s public APIs. PGlite runs the identical SQL in-process, so development and CI need no Docker or credentials. |
| DB access | `pg` (node-postgres) / PGlite, raw parameterised SQL | | The schema relies on Postgres-specific constructs; a thin `query`/`tx` adapter keeps both drivers interchangeable without an ORM abstraction leaking. |
| Auth | Custom session auth (scrypt password hashes, random session tokens stored as SHA-256, httpOnly cookies), roles `admin`/`staff`/`artist` | | Small surface, no third-party dependency, works on any host. Customers do not need accounts: bookings are accessed by an unguessable HMAC-derived token or booking ID + phone. Supabase Auth was evaluated; it would add OTP/social login later but is not required for v1. |
| Payments | Razorpay Orders + Standard Checkout + Webhooks + Refunds (REST via `fetch`) | | See `RESEARCH.md §5`. A mock gateway exists only for local development and cannot run in production. |
| File storage | Supabase Storage (REST) in production, `public/uploads` in development | | Admin uploads are validated by magic bytes; SVG uploads are refused. |
| Fonts | Cormorant Garamond (display) + Manrope (UI), self-hosted via `next/font` | | Cormorant echoes the high-contrast serif of the logo; Manrope is a clear, warm UI sans. |
| Testing | Vitest (unit + integration on in-memory PGlite), Playwright (E2E in Python, per the `webapp-testing` skill) | 5.1 / 1.65 | |
| Package manager | pnpm | 11 | Chosen by the project owner during development. |

## Not used (and why)

- **Prisma/Drizzle** — would hide the exclusion constraint and range types that guarantee no double bookings.
- **Framer Motion** — motion needs are small (one intro turn of the hand, a crossfade, a few CSS transitions); CSS and the R3F
  frame loop cover them without another 40 KB.
- **three-subdivide** — evaluated; it produced cracked, faceted geometry on this mesh and took up to 7 s on the main thread.
  Replaced by an offline Loop-subdivision script (see `3D_IMPLEMENTATION.md`).
- **Draco/meshopt compression** — Draco needs a decoder fetched from a CDN; meshopt quantisation would move vertex positions
  into quantised space and break the object-space projection. The meshes are small enough (141 KB / 562 KB transferred) to ship
  uncompressed with HTTP compression.
