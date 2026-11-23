# VAISHORA — Research findings

Research carried out on 2026-11-23 before implementation. Sources are listed per section. Where something
was not verified first-hand, it says so.

## 1. Starting point (existing project)

The folder contained only:

- `Vaishora_ Beauty, Made Personal.png` — the brand logo (apple-and-leaf emblem with mehndi flourishes, high-contrast
  serif wordmark, tagline *“Beauty, made personal.”*, on deep plum `#3D0D29`).
- `research/reseach.txt` — an investment/market assessment for a Hyderabad beauty-services marketplace.

There was no code, framework or design system to preserve, so this is a new build. Product decisions taken from the
existing research:

| Finding in `research/reseach.txt` | How it shaped the build |
|---|---|
| Biggest competitor is Instagram + WhatsApp + referrals, not another app; platform must add value to stay in the transaction | Live availability, transparent itemised prices, advance payments, booking tracking page, artist portal |
| Start with mehendi (+ makeup/hair later); event bookings have higher ticket value | Mehndi-only catalogue, but schema uses generic categories/artists so verticals can be added |
| Launch in concentrated zones (West: Gachibowli/Kondapur/Madhapur, Central, East clusters) | `localities` table seeded with 23 Hyderabad localities grouped by zone; artists declare service areas |
| Commission benchmarks 10–15%, advance/deposit model, “don’t call it escrow”, check GST/TCS with a CA | Configurable advance %, GST off by default with an admin toggle and warning, no escrow language |
| Manual matching first, don’t over-build | Booking reserves an eligible artist automatically, but artist confirmation and reassignment are manual/admin-driven |

## 2. Agent skills evaluated and installed

Installed into `.claude/skills/` (each with `SOURCE.md` — repo, path, commit, licence — and the original licence file):

| Skill | Source | Licence | Why |
|---|---|---|---|
| `frontend-design` | github.com/anthropics/skills (official) @ `e4bb5d9` | Apache-2.0 | Design-direction discipline: token plan, avoiding templated layouts, restraint, writing guidance |
| `webapp-testing` | github.com/anthropics/skills (official) @ `e4bb5d9` | Apache-2.0 | Playwright testing workflow + `with_server.py` helper; used for the E2E scripts in `tests/e2e/` |
| `threejs-react-three-fiber` | github.com/CloudAI-X/threejs-skills @ commit in SOURCE.md (~4.3k★, active Oct 2026) | MIT | Current R3F 9.8 / drei 10.7 / three r186 guidance: demand frameloop, disposal, `useGLTF`, controls |
| `threejs-performance` | same | MIT | Draw calls, texture memory, KTX2, pixel-ratio capping, shader compile stalls |

Review process: each `SKILL.md` was read in full; files were scanned for install scripts, network calls or prompt-injection
patterns (none found — they are documentation only). Nothing was executed during installation.

Evaluated but **not** installed:

- Other Anthropic skills (`docx`, `pptx`, `canvas-design`, `web-artifacts-builder`, …) — not relevant to this product.
- Community R3F skills listed on skills.sh / claudeskills.info (`freshtechbro/claudedesignskills`, `emalorenzo/three-agent-skills`,
  `enzed/r3f-skills`, `smithery r3f-fundamentals`) — overlapping with CloudAI-X; some target older fiber 8 / React 18. One good
  skill set is better than four overlapping ones.
- `threejs-shaders`, `threejs-asset-pipeline` from CloudAI-X — useful but not required; the shader work here uses the classic
  `onBeforeCompile` path, and the asset pipeline is a small custom script.

## 3. 3D hand model — licensed assets

Updated Nov 2026 after owner feedback that the hand and designs looked cartoonish (full study: `HAND_REALISM.md`).

| Candidate | Licence | Verdict |
|---|---|---|
| **MakeHuman base mesh via MPFB2 2.0.18** (extensions.blender.org) + asset packs *Skins 01* (`cutoff3d_indian_female_enhanced`, CutOff3D) and *Hands 01* (Mindfront, jujube) from static.makehumancommunity.org | **CC0** ("All core assets are shared under Creative Commons, CC0"; each pack lists CC0 per asset) | **Selected (v2).** Anatomical female hand with knuckles and nail beds, photo-derived Indian female skin texture, built headless in portable Blender; redistributable without restriction. |
| WebXR Input Profiles `generic-hand` | MIT (© 2019 Amazon) | v1, retired — low-poly VR hand without nails or skin texture. |
| V-ARM 02/03 Realistic Female Hands (TurboSquid/CGTrader/RenderHub), CGTrader photogrammetry hand scans | Paid royalty-free | Highest fidelity (8K scans); upgrade path if budget allows — confirm real-time/web redistribution and "No-AI" clauses. |
| MANO, NIMBLE, DART, HTML | Research / non-commercial | Rejected (licence). |
| Poly Haven, Smithsonian Open Access, Poly Pizza, OpenGameArt | CC0 / various | No realistic textured female hand (Smithsonian: male life casts in clenched poses; others stylised). |
| BlendSwap CC0, Sketchfab CC-BY hand scans | CC0 / CC-BY | Account required to download; not evaluated further. |

**Remaining limitation:** the CC0 skin is a full-body 2048² atlas (~400 px of real photo data for the hand), so extreme
close-ups are softer than a commercial scan; photo-derived crease normals and procedural pores compensate at normal
viewing distance.

## 4. Existing implementations and techniques

- **Decals** (`DecalGeometry`): new geometry per decal, seams at projection edges, rebuild on every switch — rejected.
- **UV mapping**: the new hand has its own baked hand-only UV layout for skin maps, but artwork is authored in a planar
  palm/back frame so it stays model-agnostic and works with admin uploads.
- **Shader projection + multiplicative stain** (chosen): object-space planar projection; mask sampled at several mip
  levels for edge / bleed halo / paste density; colour depends on density, side (palm darker) and fingertip proximity;
  applied as a multiplier on the skin albedo so skin texture shows through (henna is a dye in the outer skin layer).
- **Cone-stroke artwork**: centre-line paths converted to variable-width filled outlines (blob start, pressure, taper,
  tremor) plus hatch/jaal/checker fills; the v1 generator used uniform SVG strokes, which read as clip-art.
- **2D thumbnails**: Cycles render of the same hand with an orthographic camera matching the projection frame; CSS
  multiply layers masked by `artwork ∩ hand alpha` (`mask-composite: intersect`), blur for bleed.
- R3F patterns: `frameloop="demand"`, `useGLTF`/`useTexture` caching, texture disposal, dpr capping.

## 5. Payment gateway

Researched Razorpay’s current documentation (standard checkout, orders, webhooks):

- Orders must be created server-side; amount/currency are fixed once created.
- Checkout signature = HMAC-SHA256(`order_id|payment_id`, key secret) — verify server-side.
- Webhooks are signed with a **separate** webhook secret: HMAC-SHA256 over the **raw body**, header `X-Razorpay-Signature`.
- A verified signature on an *authorized* payment does not mean funds are captured — fetch/capture via API for critical flows.

Sources: razorpay.com/docs/payments/payment-gateway/web-integration/standard/ (and the `.md` variants returned by search),
razorpay.com/docs/webhooks/, github.com/razorpay/razorpay-node `documents/paymentVerfication.md`.

Decision: **Razorpay** (most common for Indian SMBs, UPI/cards/netbanking, test mode, refunds API, Node-friendly REST).
Cashfree Payments is a viable alternative with similar primitives; it was not researched in depth here. The provider is behind
an interface (`src/server/payments/provider.ts`), so adding Cashfree is a contained change.

Not verified in this research and must be checked before launch: current Razorpay KYC/onboarding rules for marketplaces,
whether **Razorpay Route** (split settlements to artists) is needed, MDR pricing, and RBI payment-aggregator rules for
collecting on behalf of independent artists.

## 6. Legal / tax items flagged (not resolved)

From the existing research and general knowledge — **to be validated by a CA/lawyer**: GST registration and rate for beauty
services, e-commerce operator obligations (incl. TCS) if the platform collects on behalf of artists, Consumer Protection
(E-Commerce) Rules disclosures, DPDP Act 2023 obligations for customer data. The policy pages in the app are clearly marked
as drafts.
