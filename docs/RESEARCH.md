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

| Candidate | Licence | Format | Verdict |
|---|---|---|---|
| **WebXR Input Profiles `generic-hand`** (github.com/immersive-web/webxr-input-profiles, `packages/assets/profiles/generic-hand/right.glb`) | **MIT** (© 2019 Amazon; `packages/assets/LICENSE.md`) | GLB, 1,360 verts, 2,314 tris, 25-joint skin, UVs, untextured | **Selected for v1.** Freely redistributable, correct hand anatomy and an open relaxed bind pose. Low poly, no nails, no skin textures. |
| V-ARM 02 Realistic Female Hands (TurboSquid / CGTrader / Fab / Superhive) | Paid, standard royalty-free (≈ US$35) | Blend/FBX/**GLB**, rigged, textures | **Recommended upgrade** — realistic female hands with nails and skin maps. Needs purchase + licence check for web redistribution. |
| free3d “female hands 2400” | Licence not visible in listing | Maya/FBX/3ds | Rejected — licence unclear. |
| CGTrader “HAND-018 woman right hand” (~US$7, Royalty Free No-AI) and others | Paid | some GLB | Possible alternatives; check “No AI” clauses. |
| Poly Haven / Sketchfab CC0 | — | — | No suitable realistic CC0 female hand found in this pass. |

Sources: TurboSquid/CGTrader/Fab listings returned by search (2026-11-23); webxr-input-profiles repository and licence read
directly via the GitHub API.

**Limitation (important):** the shipped hand is a smoothed version of a low-poly VR hand. It reads as a clean, stylised hand,
but it is not photoreal (no skin textures, nails are simulated in the shader, generic proportions). The texture system is
model-agnostic — swapping to a licensed photoreal GLB requires re-running two scripts (see `3D_IMPLEMENTATION.md`).

## 4. Existing implementations and techniques

- **Decals** (`three/addons/geometries/DecalGeometry.js`): projects onto a mesh by creating new geometry per decal. Good for
  stickers; for full-hand artwork it creates seams at projection edges and costs geometry rebuilds on each switch.
- **UV mapping**: best fidelity when the model has clean, purpose-made UVs. The candidate model’s UVs are a VR atlas not
  laid out for artwork; a paid model would need checking too.
- **Shader-based projection + blending** (MeshPhysicalMaterial `onBeforeCompile`): project artwork in object space, weight by
  surface normal, blend into albedo. No extra geometry, instant texture swap, GPU crossfade, works with any model.
- R3F patterns (from the installed skill): `frameloop="demand"`, `useGLTF` caching, drei `OrbitControls` with damping,
  disposal of textures, `PerformanceMonitor`/dpr capping.

Selected: shader projection (details and reasoning in `3D_IMPLEMENTATION.md`).

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
