# 3D mehndi hand — implementation

Realistic female hand built from CC0 MakeHuman assets. Research, licences, the photo study of real henna and the
honest list of remaining gaps are in [`HAND_REALISM.md`](HAND_REALISM.md). One-shot rebuild: `scripts/hand-real/build.sh`.

## Pipeline overview

```
MakeHuman base mesh + CC0 hand targets + CC0 "Indian female" skin   (MPFB2 in portable Blender 4.5, headless)
        │  scripts/hand-real/build_hand.py   → scripts/out/hand-build/hand-{hq,lq}.glb, albedo.png, nails.png
        │                                      (cut at mid-forearm; metres, palm faces −X, fingers −Y; WebXR-named joint empties)
        │  scripts/build-hand.mjs            → public/models/hand-hq.glb (55k tris) / hand-lq.glb (13.7k tris)
        │  scripts/hand-real/postprocess.py  → public/models/hand-albedo-{2k,1k}.jpg, hand-normal-{2k,1k}.jpg, hand-detail-1k.jpg
        │  scripts/extract-landmarks.mjs     → src/lib/mehndi/hand-landmarks.json (projection frame, joints, finger widths)
        ▼
src/lib/mehndi/{geometry,cone,motifs,hand2d,artwork}.ts   original cone-drawn artwork placed on the landmarks
        │  scripts/generate-artwork.ts      → public/designs/<style>-<palm|back|feet>.svg (white on transparent; alpha = paste density)
        ▼
src/components/hand/mehndiMaterial.ts     skin (albedo / normal / detail, subsurface-style bleed) + multiplicative henna stain
src/components/hand/HandScene.tsx         R3F canvas, lighting, controls, crossfade, per-tier skin maps
src/components/hand/HandViewer3D.tsx      lazy loading, WebGL detection, quality tiers, one-row 44px controls, fallback
src/components/hand/HandIllustration.tsx  thumbnails + fallback: Cycles still (public/hand/{palm,back}.webp from
                                          scripts/hand-real/render_stills.py) + stain layers masked by artwork ∩ hand
```

## Why shader projection (decision record)

| Approach | Realism | Switch cost | Works with any model | Chosen |
|---|---|---|---|---|
| UV texture mapping | Highest *if* UVs are made for artwork | texture swap | No — depends on UV layout | — |
| Transparent overlay mesh | Floats above skin, z-fighting | swap | Partly | ✗ |
| Decal projection | Good, seams at projector edges | rebuild geometry per switch | Yes | ✗ |
| **Object-space projection in the skin shader** | Stain is part of the albedo → lit, shaded and curved exactly like skin | **uniform swap + GPU crossfade** | **Yes** | ✓ |

Details (`mehndiMaterial.ts`):

1. The vertex shader passes the **bind-pose** position and normal, so the artwork stays glued to the skin however the
   hand is rotated.
2. Two planar projections share one square frame from `hand-landmarks.json` (palm projection, and the mirrored back
   projection), so artwork is never stretched.
3. Blend weight = `smoothstep(0.05, 0.4, ±normal.x)`, so finger sides fade naturally instead of smearing.
4. The artwork alpha is sampled at three blur levels (edge with a tiny wobble, bleed halo, local paste density) and
   darkens the skin albedo **multiplicatively**: thin lines warm red-brown, dense fills and fingertips deep maroon-brown,
   palm deeper than the back, blotchy take-up, small breaks in deep creases; nails excluded. Pores and creases show
   through, as with a real dye. See `HAND_REALISM.md` §3–4.
5. Two texture slots per side (`A`/`B`) and `uMix` give a 450 ms smoothstep crossfade; the scene is not recreated.
6. Skin: `MeshPhysicalMaterial` with the CC0 albedo, a photo-derived normal map, a detail map (R = nail mask → gloss,
   G = crease cavity → roughness and stain breaks), sheen and a warm subsurface-style bleed into shadows; the forearm
   cut dissolves into the stage with alpha.

## Artwork system

- All built-in designs are **generated in code** — `cone.ts` turns centre lines into cone-drawn strokes (variable width,
  blob start, taper/dot end, tremor) and provides hatch, jaal (net) and checker fills; `motifs.ts` holds keri, lotus,
  peacock, bel vine with tendrils, rose, shaded-petal mandalas, bands; `artwork.ts` composes each style on the hand's
  landmarks. Nothing is traced from photographs or third-party designs. Slugs/file names are unchanged.
- Output: square SVGs, white on transparent (`public/designs/*.svg`), used as a texture mask (3D), as a CSS mask in the
  2D stain composite (thumbnails and fallback), and as portfolio samples for demo artists.
- Admin uploads: transparent PNG/WebP aligned to the palm/back templates (`/hand/palm.webp`, `/hand/back.webp` — the
  stills cover exactly the projection frame). Only alpha is used.
- Feet designs are illustrations only (no 3D foot model); the viewer says so.

## Geometry & textures

- MakeHuman hm08 hand, Catmull-Clark subdivided: `hand-hq.glb` 55k tris (981 KB), `hand-lq.glb` 13.7k tris (276 KB),
  packed with `KHR_mesh_quantization` (float positions for exact projection, int8 normals, uint16 UVs).
- Albedo / normal 2048² (high tier) or 1024² (low tier) JPEG; detail 1024² for both.

## Interaction

- drei `OrbitControls`: horizontal drag rotates, vertical drag tilts the wrist (polar angle limited to 0.22π–0.78π), wheel /
  pinch zooms (0.28–0.9 m), no panning, damping on. Palm/Back buttons and Reset animate the camera along the shortest arc.
- **Touch and scrolling:** the canvas uses `touch-action: pan-y`, so on phones vertical swipes keep scrolling the page while
  horizontal drags rotate and pinches zoom. A “Free rotate” toggle switches to `touch-action: none` for full rotation.
- One short introductory turn (three-quarter view → palm) on load; skipped with `prefers-reduced-motion`. No auto-rotation.
- The camera turns to the side that has artwork when a back-only or palm-only design is selected.
- **Controls bar**: one row at every width — Palm/Back segmented control (44px) and 44px icon buttons (zoom in/out,
  reset, free-rotate below `md`) with `aria-label`s. Below 360px the zoom buttons are hidden (pinch covers zoom) so the
  row fits inside the stage.

## Performance

- Canvas `frameloop="demand"`: nothing renders while idle; animations call `invalidate()` only while active.
- The 3D bundle (three + R3F + drei) loads via `next/dynamic` only when the viewer nears the viewport; text, CTAs and the
  static illustration paint first.
- Quality tier: `low` (LQ mesh, 1K skin maps, 1024² artwork, dpr ≤ 1.5) for phones, ≤ 4 cores, ≤ 3 GB memory or
  Save-Data; otherwise `high` (HQ mesh, 2K skin maps, 2048² artwork, dpr ≤ 2).
- Payload: mobile ≈ 0.50 MB, desktop ≈ 1.40 MB (+ the design SVG, 17–330 KB, gzip-friendly).
- Environment lighting is baked once from local `Lightformer`s (no HDR download).
- Artwork textures are cached (LRU of 8) and disposed on eviction; material and skin maps are disposed on unmount.

## Fallback

`HandViewer3D` detects WebGL; if unavailable (or the scene errors), `HandIllustration` shows the photographic still
with the selected design composited as a stain. Design switching, prices and booking keep working
(`tests/e2e/webgl_fallback.py`).

## Upgrading to a scanned hand

Any GLB in the same convention (metres, palm −X, fingers −Y, WebXR-named joint empties, one UV set + albedo) can replace
`scripts/out/hand-build/hand-*.glb` / `albedo.png`; then rerun `build-hand.mjs`, `postprocess.py`,
`extract-landmarks.mjs`, `pnpm artwork:generate`, `render_stills.py` and `stills_web.py`. Candidate: V-ARM 03 (paid).

## Known limitations

See `HAND_REALISM.md` §6. Mobile GPU testing was done with desktop Chromium device emulation, not on physical phones.
