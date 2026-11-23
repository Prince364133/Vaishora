# VAISHORA

Mehndi designs on an interactive 3D hand, transparent pricing, and real-time booking of mehndi artists in Hyderabad.

```bash
pnpm install
cp .env.example .env.local
pnpm db:seed -- --demo     # local embedded Postgres + catalogue + admin (password printed) + demo artists
pnpm dev                   # http://localhost:3000  ·  admin: /admin/login
pnpm test                  # unit + integration tests
```

| Doc | Contents |
|---|---|
| [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) | What is done, partial, pending; credentials and assets needed |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Skills, 3D assets, techniques and payment research with sources |
| [docs/TECH_STACK.md](docs/TECH_STACK.md) | Stack and the reasons behind each choice |
| [docs/3D_IMPLEMENTATION.md](docs/3D_IMPLEMENTATION.md) | Hand pipeline, mehndi projection shader, performance, upgrade path |
| [docs/UI_UX_STRATEGY.md](docs/UI_UX_STRATEGY.md) | Design plan, tokens, mobile-first and accessibility decisions |
| [docs/PROJECT_ARCHITECTURE.md](docs/PROJECT_ARCHITECTURE.md) | Data model, booking state machine, availability, payments, security |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Local setup, tests, Vercel + Supabase + Razorpay production setup |
| [docs/QA_REPORT.md](docs/QA_REPORT.md) | Test results, performance numbers, bugs fixed, gaps |

Project skills used during development live in `.claude/skills/` (see each `SOURCE.md` for origin and licence).
3D model attribution: `public/models/LICENSE.md`.
