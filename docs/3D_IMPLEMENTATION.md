# 3D mehndi hand — implementation

## Pipeline overview

```
public/models/hand-right.glb   (WebXR generic hand, MIT)
        │  scripts/extract-landmarks.mjs   → src/lib/mehndi/hand-landmarks.json (joint positions in artwork space + projection frame)
        │  scripts/build-hand.mjs          → public/models/hand-hq.glb (18.5k verts) + hand-lq.glb (4.6k verts)
        │                                    src/lib/mehndi/hand-nails.json (nail centres)
        ▼
src/lib/mehndi/{geometry,motifs,hand2d,artwork}.ts   original artwork generator, placed on the landmarks
        │  scripts/generate-artwork.ts      → public/designs/<style>-<palm|back|feet>.svg (white on transparent)
        ▼
src/components/hand/mehndiMaterial.ts   skin shader + mehndi projection + nail simulation
src/components/hand/HandScene.tsx       R3F canvas, lighting, controls, crossfade
src/components/hand/HandViewer3D.tsx    lazy loading, WebGL detection, quality tiers, DOM controls, fallback
src/components/hand/HandIllustration.tsx  static (non-WebGL) preview: silhouette + artwork mask
```

## Why shader projection (decision record)

| Approach | Realism | Switch cost | Works with any model | Chosen |
|---|---|---|---|---|
| UV texture mapping | Highest *if* UVs are made for artwork | texture swap | No — depends on UV layout | — |
| Transparent overlay mesh | Floats above skin, z-fighting | swap | Partly | ✗ |
| Decal projection | Good, seams at projector edges | rebuild geometry per switch | Yes | ✗ |
| **Object-space projection in the skin shader** | Stain is part of the albedo → lit, shaded and curved exactly like skin | **uniform swap + GPU crossfade** | **Yes** | ✓ |

Details (`mehndiMaterial.ts`):

1. The vertex shader passes the **bind-pose** position and normal (`position`, `normal`), so the artwork stays glued to the
   skin regardless of how the hand is rotated.
2. Two planar projections share one frame (from `hand-landmarks.json`): palm projection (viewer looking at the palm) and back
   projection (mirrored). The frame is square (0.2205 m) so artwork is never stretched.
3. Blend weight = `smoothstep(0.08, 0.42, ±normal.x)`, so finger sides fade naturally instead of smearing.
4. The artwork alpha becomes a mask that mixes the albedo towards a henna colour with low-frequency tonal variation — a
   stain, not a sticker. It is then shaded by the PBR lighting like the rest of the skin.
5. Two texture slots per side (`A`/`B`) and `uMix` give a 450 ms smoothstep crossfade; the scene is not recreated.
6. Skin: `MeshPhysicalMaterial` with sheen and a little clearcoat, lighter/pinker palm tone, subtle pigment and roughness
   noise. Nails: elliptical masks around precomputed nail centres, glossier and lighter.

## Artwork system

- All built-in designs are **generated in code** (`src/lib/mehndi/artwork.ts`) from an original motif library — paisleys, petal
  rings, mandalas, lattices (jaal), vines with leaves, roses, finger bands, fingertip caps and wrist bracelets — positioned
  using the hand’s real joint landmarks. Nothing is traced from photographs or third-party designs.
- Output: square SVGs, white on transparent (`public/designs/*.svg`), used as a texture mask (3D), as a CSS mask in henna
  colour (thumbnails and fallback), and as portfolio samples for demo artists.
- Admin uploads: transparent PNG/WebP aligned to the palm/back templates (`/hand/palm.webp`, `/hand/back.webp`), stored as
  `design_assets`. The shader uses only the alpha channel, so any colour works.
- Feet designs are illustrations only (there is no 3D foot model); the viewer says so.

## Geometry

- The source mesh is low poly. `three-subdivide` produced cracks and faceting and took up to ~7 s on the main thread, so
  `scripts/build-hand.mjs` implements standard **Loop subdivision** (with boundary rules for the wrist opening), welds
  vertices, recomputes smooth normals and writes a minimal GLB (positions, normals, indices).
- Two LODs: `hand-lq.glb` (1 iteration, 4.6k verts, 164 KB raw / 141 KB transferred) and `hand-hq.glb` (2 iterations,
  18.5k verts, 652 KB / 562 KB).

## Interaction

- drei `OrbitControls`: horizontal drag rotates, vertical drag tilts the wrist (polar angle limited to 0.22π–0.78π), wheel /
  pinch zooms (0.28–0.9 m), no panning, damping on. Palm/Back buttons and Reset animate the camera along the shortest arc.
- **Touch and scrolling:** the canvas uses `touch-action: pan-y`, so on phones vertical swipes keep scrolling the page while
  horizontal drags rotate and pinches zoom. A “Free rotate” toggle switches to `touch-action: none` for full rotation.
- One short introductory turn (three-quarter view → palm) on load; skipped with `prefers-reduced-motion`. No auto-rotation.
- The camera turns to the side that has artwork when a back-only or palm-only design is selected.

## Performance

- Canvas `frameloop="demand"`: nothing renders while idle; animations call `invalidate()` only while active.
- The 3D bundle (three + R3F + drei) loads via `next/dynamic` only when the viewer nears the viewport; text, CTAs and the
  static illustration paint first.
- Quality tier: `low` (LQ mesh, 1024² artwork, dpr ≤ 1.5) for phones, ≤ 4 cores, ≤ 3 GB memory or Save-Data; otherwise
  `high` (HQ mesh, 2048² artwork, dpr ≤ 2).
- Environment lighting is baked once from local `Lightformer`s (no HDR download).
- Artwork textures are cached (LRU of 8) and disposed on eviction; material is disposed on unmount.

## Fallback

`HandViewer3D` detects WebGL; if unavailable (or the scene errors), `HandIllustration` shows the hand silhouette with the
selected design. Design switching, prices and booking keep working (verified by `tests/e2e/webgl_fallback.py`).

## Upgrading to a photoreal hand

1. Buy/licence a realistic female hand GLB (e.g. V-ARM 02) and confirm web redistribution is allowed.
2. Pose it open and flat, palm facing −X with fingers along −Y (or adapt the frame constants), export GLB.
3. Replace `public/models/hand-right.glb`, then run `node scripts/extract-landmarks.mjs public/models/hand-right.glb`,
   `node scripts/build-hand.mjs` (set iterations to 0 if the mesh is already dense), and `pnpm artwork:generate`.
4. If the model has skin textures, add them as `map`/`normalMap` on the material — the projection code is unchanged.

## Known limitations

- Stylised, not photoreal (see above). No real fingernails geometry.
- KTX2 compression is not used: artwork is generated at runtime from SVG (crisp at any size); textures are 1–2K RGBA.
- Mobile GPU testing was done with desktop Chromium device emulation and a 4× CPU slowdown, not on physical phones.
