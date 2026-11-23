# Realistic hand & real-looking mehndi

Owner feedback (Nov 2026): *"the hand is cartoonish and the designs are cartoonish … build a real human hand with the
right physical appearance … learn from real images how real mehndi looks on real hands."* This document records the
research, the licence decision, how the assets are built, the photo study of real henna, and what is still missing.

## 1. Which hand, and why (licence first)

The site has to ship the model to every browser, so the licence must allow **public redistribution** of the mesh and
textures. Research-only hand models (MANO, NIMBLE, DART, HTML), Mixamo raw redistribution, unclear "free" listings and
anything behind a login were excluded.

| Candidate | Licence | Verdict |
|---|---|---|
| **MakeHuman base mesh via MPFB2** + CC0 skin/hand packs | **CC0** (core assets, Skins 01, Hands 01) | **Chosen.** Anatomically modelled hand with knuckles and nail beds, slider-controlled female proportions, and a **CC0 Indian female skin texture** (CutOff3D) that is photo-derived (real palm creases, knuckle folds, nails). Built headless with open-source Blender. |
| WebXR Input Profiles generic hand (previous) | MIT | Retired: low-poly VR hand, no nails, no skin texture → read as a cartoon. |
| Poly Haven, Smithsonian Open Access, Poly Pizza, OpenGameArt | CC0 / various | No realistic female hand with skin maps (Smithsonian has life casts of male hands in clenched poses; others are stylised). |
| BlendSwap CC0 hands, Sketchfab CC-BY scans | CC0 / CC-BY | Download requires an account we do not have. |
| V-ARM 02 / 03 (CGTrader, TurboSquid, RenderHub), CGTrader scanned female hands | Paid royalty-free | Best possible fidelity (8K scans) — the upgrade path if budget allows; check "web/real-time redistribution" and "No-AI" clauses before buying. |

Exact sources and licences: `public/models/LICENSE.md`.

## 2. How it is built (reproducible: `scripts/hand-real/build.sh`)

1. **Blender 4.5 LTS portable** (zip from download.blender.org, `portable/` folder so nothing is installed) + **MPFB2
   2.0.18** (extensions.blender.org) + MakeHuman CC0 packs (system assets, Skins 01, Hands 01) from
   static.makehumancommunity.org. Archives were unpacked into separate scratch folders; no scripts from the archives were
   run other than Blender and the official add-on.
2. `build_hand.py` (headless): young adult woman (gender 0, slim, proportions 0.8, blended Asian/Caucasian/African
   macro — MakeHuman has no South-Asian macro; tone comes from the texture); CC0 hand targets (finger correction,
   thenar/hypothenar, subtle knuckles) and slimmer, slightly longer fingers; default rig used to relax the curl and fan
   the fingers; mesh evaluated, **cut at mid-forearm** (~6 cm below the wrist), the hand island kept, reoriented to the
   viewer convention (**metres, palm faces −X, fingers point −Y**), Catmull-Clark subdivided (HQ level 2, LQ level 1),
   re-unwrapped to a hand-only UV layout and the skin **baked** from the body atlas; a nail mask is baked from the base
   mesh `fingernails` group. Joint empties are exported with WebXR names.
3. `build-hand.mjs` packs the GLBs (float positions — the shader needs exact bind-pose positions — int8 normals,
   uint16 UVs, `KHR_mesh_quantization`, decoded natively by three.js).
4. `postprocess.py`: fills empty UV space, grades the skin towards a warm medium South-Asian complexion, damps the
   source's painted red patches and mid-scale blotches (keeps fine creases), adds fine pigment mottling, derives a
   **normal map** from the photo detail (high-pass luminance → creases, knuckle wrinkles) plus sparse pore pits, and a
   **detail map** (R = nail mask, G = crease cavity).
5. `extract-landmarks.mjs` writes the projection frame, joints and measured finger widths to
   `src/lib/mehndi/hand-landmarks.json`; the artwork generator places motifs on these landmarks.
6. `render_stills.py` renders palm/back **Cycles** stills (SSS skin, soft key/fill/rim, AgX) with an orthographic
   camera covering exactly the projection frame → `public/hand/palm.webp`, `back.webp`, so 2D thumbnails line up with
   the same artwork as the 3D view. `stills_web.py` also writes the 2D stain colour fields.

### Asset budget

| Asset | Desktop (high) | Mobile (low) |
|---|---|---|
| Mesh | `hand-hq.glb` 986 KB, 55k tris | `hand-lq.glb` 279 KB, 13.7k tris |
| Albedo | 2048² JPEG 194 KB | 1024² JPEG 72 KB |
| Normal | 2048² JPEG 111 KB | 1024² JPEG 44 KB |
| Detail (nail mask, cavity, nail free edge) | 1024² JPEG 108 KB | same |
| **Total 3D payload** (+ artwork SVG, 17–330 KB) | **≈ 1.40 MB** | **≈ 0.50 MB** |

2D stills: `palm.webp` 40 KB, `back.webp` 39 KB; stain fields < 1 KB.

## 3. How real mehndi looks — photo study

Studied openly licensed photographs on Wikimedia Commons (CC0 / CC BY / CC BY-SA, e.g. "Bridal Mehndi.JPG",
"Bridal mehndi (henna) is a central wedding tradition 02/05/10", "Front and back hand mehendi design.jpg",
"Mehndi decoration on back side of hands.jpg", "Henna on the hand of a bride, India (2016).jpg",
"Hand palm, female, maruthani-TamilNadu206.jpg", "Wedding Henna.jpg"). Photos were viewed for study only, not
committed, and no design was copied or traced.

**Stain colour and how it develops**
- Fresh stain (paste just removed): bright orange (≈ #d9682a on light-medium skin). Over 24–48 h it oxidises to
  red-brown → maroon-brown (≈ #7a2c16 → #4e1a0e). Our renders show a mature (day 2–3) stain.
- **Darker on palms, fingertips and finger pads** (thick keratin layer takes more lawsone); lighter, browner and less
  saturated on the back of the hand and the wrist/forearm. Dipped fingertips are the darkest areas of the whole hand.
- The stain is a **dye in the skin**, not a layer on it: skin texture, palm creases and knuckle wrinkles stay visible
  through it, highlights stay the colour of the light, and the stain darkens the skin multiplicatively.

**Line character (cone work)**
- Line width varies continuously with pressure (≈ 0.5–2 mm); bold outlines next to hairline fill strokes.
- Lines start with a small **blob** where the cone touches down, end in a **taper** (or a deliberate dot).
- Slight wobble/tremor; circles overlap a little where the artist closes them.
- Dots are slightly oval; dot trails shrink along the trail.
- **Shading**: solid paste along a motif's edge fading inwards as fine parallel strokes; "shaded petals" with a solid
  core; **jaal** (net) and **checker** grounds fill large areas in bridal work.
- Paste spreads a little: thick fills and dense jaal stain darker and slightly blurred; thin lines are lighter and
  warmer, with a faint orange **halo**.
- Tiny gaps where paste skipped deep creases; uneven take-up (blotchiness) across large fills.
- Dried paste (before removal) is a different look: raised, dark green-black/brown, cracked and matte. We render the
  stain, not the paste.

## 4. Implementation of the stain

**Artwork generator** (`src/lib/mehndi/cone.ts`, `motifs.ts`, `artwork.ts`): every line is a filled, variable-width
cone stroke (blob start, pressure swell/flutter, tapered or dotted end, low-frequency tremor, overlapping closed
loops); fills include hatch shading, jaal net with dots, checker with solid cells, solid shaded bands; motif vocabulary:
shaded keri (paisley) with banded edge, kamal (lotus), mor (peacock), bel (vine) with half-filled leaves and spiral
tendrils, spiral rose, shaded-petal mandalas, dome arches, finger bands (beads, zigzag, net, checker, scallop),
filled/arched fingertips, layered bracelets. All artwork is generated and original; file names/slugs are unchanged.

**3D shader** (`src/components/hand/mehndiMaterial.ts`): mask sampled at three blur levels (sharp edge with a tiny
UV wobble, halo, local density); colour ramps from warm red-brown (thin lines) to deep maroon-brown (dense fills,
fingertips); palm deeper than back; low-frequency blotchiness; breaks in deep creases (detail map cavity); applied
multiplicatively over the skin albedo so pores/creases show through; nails excluded. Skin: albedo + photo-derived
normal map, nail gloss from the detail map, wrap-style subsurface bleed, forearm cut dissolves into the stage.

**2D thumbnails / fallback** (`HandIllustration.tsx`): Cycles still of the real hand + two multiply layers masked by
*artwork ∩ hand alpha*: a blurred light-orange bleed and the stain colour field (deeper at fingertips and palm centre,
lighter towards the wrist, lighter on the back). Works for any artwork URL, including uploaded PNG/WebP.

## 5. Beauty pass — what makes a hand look beautiful (Nov 2026)

Owner feedback on v2: *"make the girl's hand beautiful … the texture is too black and not good."* The v2 back of hand
was dark red-brown and blotchy (the CC0 texture's painted patches), nails were muddy, fingers thick, the pose stiff,
and the realtime key light only lit the palm side.

**Research (hand-model casting criteria, beauty / jewellery / bridal-mehndi photography, anthropometry):**
- *Skin:* clear, **even tone**, no visible redness, scars, blotches or prominent veins; tendons may show only subtly;
  low-contrast pores. Smooth, **non-prominent knuckles** without deep wrinkles or dark patches (agency requirements:
  "no lumpy knuckles, lines or scars", "even skin tone is key").
- *Fingers:* long, straight, **slender and tapering** towards the tips; female hands have a relatively longer index
  finger (2D:4D ratio ≈ 0.97–1.0, vs lower in men); fingers ≈ 0.8–0.9 × palm length in well-proportioned hands.
- *Nails:* **long oval nail beds**, natural pink bed, white/translucent free edge, glossy surface, clean cuticles, no
  dark rim.
- *Colour (medium Indian / wheatish complexion, golden-honey undertone; albedo targets in sRGB):* back of hand
  **#C9956F**, palm lighter and pinker **#E3AF92** (thick stratum corneum, little melanin), rosy fingertip/knuckle-top
  flush **#D99A86** (very soft), nail bed **#E9AFA3**, free edge **#F6EADF**.
- *Light:* soft key + warm fill + gentle rim; light bleeding through finger edges (subsurface glow) is the signature
  of living skin; no hard, muddy shadows.
- *Pose:* relaxed and elegant — a gentle cascade of curl from index to pinky, fingers softly fanned, thumb relaxed.

**What changed:**
- `build_hand.py`: slimmer and longer fingers (`r-hand-fingers-diameter-decr 0.45`, `length-incr 0.35`, `scale-decr
  0.1`), knobby-knuckle target removed, an extra **radial taper** (1.0 at the base → 0.89 at the tip of each finger),
  elegant pose (curl cascade, fan, relaxed thumb); new bakes: object-space normal (palm/back mask) and nail
  **free-edge** mask.
- `postprocess.py`: the albedo is now **composed** — target tones above blended by the baked palm/back mask, soft
  fingertip flush, designed nail colours with a soft cuticle edge; from the photo only fine, low-contrast luminance
  detail is kept (pores, fine lines; palm creases stronger than on the back). All large-scale mottling, red/brown
  patches and dark knuckles are gone by construction. Normal map: creases strong on the palm, faint on the back.
- Shader: neutral tone (balance is in the albedo), **glossy clear-coat nails** (per-pixel clearcoat on the nail mask),
  light through the nail free edge, warm **edge translucency** term plus the existing subsurface bleed, softer
  normals, slightly stronger sheen. `HandScene`: **symmetric** soft warm key lights for palm and back, warm low fill,
  higher warm ambient, mirrored environment light box — the back is no longer in shadow.
- Stills (`render_stills.py`): neutral tone, glossy nails, Standard view transform so the stills match the realtime
  colours.

Screenshots: `scripts/out/hand/beauty/` (`before-*`, `after-*`, `compare-1366.jpg`).

## 6. Honest gaps / what would make it better

- **Texture resolution**: the CC0 skin is a 2048² *full-body* atlas, so the hand had ~400 px of real photo data; it is
  baked to 2048² and sharpened with procedural pores and photo-derived normals, but extreme close-ups look soft
  compared with an 8K scan. A paid scanned hand (e.g. V-ARM 03 dark skin, ~US$35) would remove this; the pipeline
  (landmarks → artwork → shader) works with any GLB in the same orientation.
- The MakeHuman hand is a sculpted average, not a scan: knuckle/vein detail is moderate, nails are part of the skin
  surface (no separate translucent nail plate geometry).
- Skin colour is now designed (target tones) with only fine detail from the CC0 photo texture; one complexion only
  (no tone selector). Very close up the back of the hand can read slightly smooth (retouched-advert look).
- Subsurface scattering in real time is an approximation (wrap/terminator bleed), not true SSS.
- Feet remain an illustration (no CC0 photoreal foot built yet; MakeHuman has feet, so the same pipeline could do it).
- Uploaded artwork must be aligned to the new templates (`/hand/palm.webp`, `/hand/back.webp`); artwork aligned to the
  *old* stylised silhouettes will sit slightly differently on the new hand.
