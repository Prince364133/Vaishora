# Hand poses and skin realism: plan

Status on 23 Nov 2026: skin-tone fixes (section 1) and the Photo 3D rebuild (section 1b) are done. More hand poses are
a proposal (sections 2 to 4).

## 1. Done in this pass

| Viewer | Problem | Fix |
|---|---|---|
| Photo 3D | Skin rendered yellow-orange and blown out, and the henna turned orange. three r163+ scales `scene.environment` by `scene.environmentIntensity`. The material's `envMapIntensity: 0.18` was ignored, so the room environment lit the photo at full strength on top of the 0.5 emissive (about 1.6× the photo). | Measured each light on the front view and set a budget that adds up to about 1.0: emissive 0.55, key 1.2, hemi 0.35, `environmentIntensity` 0.06. Added a highlight shoulder that keeps the hue, so bright skin can't clip to yellow. |
| Photo 3D | Skin was blotchy and uneven. | Frequency separation on skin only: low-frequency blotches are softened and 60% of the fine detail (pores, palm lines) is kept. Skin colour is pulled 20% toward one clean warm hue. Henna is detected by its chroma and left sharp. |
| 3D model | Skin was bumpy and greyish. | Normal map strength cut from 0.65 to 0.42 (creases stay, bumpiness goes), plus an 18% pull toward one clean warm skin hue. |
| Both | Skin tone could only be changed in Photo 3D. | The Natural / Fair / Tan / Deep swatch is now on both toolbars. The tone is shared by every stage and saved on the device (`vaishora.tone`). On the 3D model it's applied to the skin before the henna, so the stain colour stays true on every tone. |
| Mobile | The new swatch made the 3D model toolbar overflow at 375px. | Zoom +/- buttons are hidden below 420px. Pinch zoom covers zooming there. |

## 1a. Update: Photo 3D is the zip's viewer again (owner decision)

The owner chose the mehndi-3d-tryon viewer itself, the 3D made from the photo, for Photo 3D. Sections 1b–1c now
apply to the **3D model** viewer only: Codex palm/back photos, rest-position projection. The two-hand sculpted pair is
kept for reference in `scripts/out/PhotoHandScene.real3d.tsx.bak`.

## 1b. Photo 3D rebuilt on real 3D hands (superseded, see 1a)

The old Photo 3D was a flat photo pushed into a slab (a height map). When turned it showed saw-tooth edges, flat
stretched sides, fused fingers and a flat-cut forearm. It is replaced:

- **Two real 3D hands** (the sculpted MakeHuman hand plus its mirror), posed like the photograph: palms up, fingers
  towards the viewer, thumbs outwards. Full 360° turn.
- **Palm:** the photographed henna is warped onto the 3D palm (`scripts/hand-real/photo_transfer.py`, existing). The stain
  is deepened to the maroon / chocolate-brown of real bridal photos by `scripts/hand-real/deepen_stain.py`; originals
  are backed up in `scripts/out/palm-orig/`.
- **Back:** new. `scripts/hand-real/back_photos.py` asks Codex to paint each design onto `public/hand/back.webp`, a render
  of the 3D hand's own back, using the palm photo as a style reference. Because Codex paints on the model's own
  render, the result fits the model with no warping (ECC alignment, ~99% outline match). There is a stain and a
  paste version for every design. Manifest: `"back"` in `src/lib/mehndi/photo-palm.json`. The 3D model viewer uses these
  back photos too, for exact catalogue matches.
- **Motion:** inertia spin (flick and glide to a stop), intro sweep, idle sway after 3.5 s (paused off screen and with
  reduced motion), a showcase turn and 0.5 s crossfade on design change, and a palm/back Turn button.
- **Colour:** in the skin shader, photo henna is pulled darker and its warm subsurface glow is reduced, so the
  lighting and tone mapping no longer turn dark maroon into orange.
- Removed: `public/tryon/hands.glb`, `hmap.png`, `mask.png`, `atlas-*.jpg`, `background.jpg`, `manifest.json`, and
  `scripts/tryon/build_model.py` (6.2 MB). The card thumbnails (`public/tryon/thumb-*.jpg`) stay for the no-WebGL fallback.

Rebuild the backs (≈1 min per image, Codex login needed): `python scripts/hand-real/back_photos.py [--ids trail --looks stain] --force`.
Check images: `scripts/out/back-photos/*_check.jpg`. The cyan line is the model outline.

## 1c. Hand type matched to the bare-hands reference photo

- **Pose** (`src/components/hand/handPose.ts`, `REFERENCE_POSE`): the four fingers rest side by side with no gaps
  (rotation at the knuckle plus a sideways slide blended through the web of the hand), soft curl, and thumbs relaxed
  outwards, like `mehndi-3d-tryon/generated-images/bare-hands.jpg`. It's applied to the mesh at load time; the henna is
  projected from the stored rest surface (`restPosition` / `restNormal`), so it stays glued to the skin.
- **Long forearms** like the photo: the Photo 3D viewer moves the forearm fade up the arm (`uCutY`).
- **Codex palms:** `back_photos.py --side palm` paints each design straight onto the 3D palm render
  (`<id>-palm-cx[-stain].webp`, manifest `palmCodex`). Both viewers prefer it over the warped photo palm, which had
  seam lines at the finger bases.
- Bangles (gold + maroon glass) and soft self-shadows are added for photographic realism.
- High-resolution check: `node scripts/shot-photo3d.mjs` → `scripts/out/shots/photo3d-{palm,back,3q}.png`.

## 2. Recommended hand poses

Mehndi customers judge a design by how it sits on the palm, the back and the fingers. Choose poses that show those areas clearly:

| # | Pose | Shows | 3D model | Photo 3D | Priority |
|---|---|---|---|---|---|
| 1 | **Open palm, fingers relaxed** (current) | Palm centre, finger patterns, wrist | ✅ now | ✅ now | — |
| 2 | **Back of hand, fingers slightly fanned** | Back designs (Arabic, haath-phool, rings) | ✅ now (turn) | ❌ needs new photo set | High |
| 3 | **Bridal pair: two palms side by side, little fingers touching** | Mirror bridal sets, doli and dulha-dulhan scenes across both palms | ✅ mirror the mesh | ✅ now (current photo) | High |
| 4 | **Namaste / joined palms, side view** | Wrist bands and the edges of the fingers, a popular bridal photo | Rebake | New photo set | Medium |
| 5 | **Soft cupped "offering" pose** (palm up, fingers curled 20–30°) | Palm mandala with a natural depth, very photogenic | Rebake | New photo set | Medium |
| 6 | **Hand on chin / graceful wrist turn** (back of hand, ¾ view) | Back and wrist cuff in one view, Instagram-style | Rebake | New photo set | Low |
| 7 | **Feet, top view** | Feet designs, now only an illustration | New model | New photo set | Low |

On the website, show the poses as a small chip row under the viewer (`Palm · Back · Bridal pair · Cupped · Namaste`). Use one chip per pose and crossfade between them with the camera transition you already have. Show only the chips that the selected design supports: Arabic back designs open on **Back**, bridal designs on **Bridal pair**.

## 3. How to build the poses

### 3D model (best effort for the cost)
The GLB is a static mesh with no skin. Its pose is baked in Blender by `scripts/hand-real/build_hand.py`, using the MPFB rig.
1. Add a `--pose <name>` option to `build_hand.py` and keep the finger joint rotations for each pose in a small JSON file.
2. **Important:** export the **rest-pose position as a second attribute** (`_REST_POSITION`), and have `mehndiMaterial.ts` project from it (`vBindPos = restPosition`). Without this, the artwork slides when the fingers curl. With it, the henna stays glued to the skin in every pose.
3. Run `build-hand.mjs` for each pose → `public/models/hand-hq-<pose>.glb` (about 1 MB each, lazy-loaded when that chip is picked).
4. Bridal pair: render the same mesh twice. The second copy gets scale.x = −1, and its artwork projection is flipped to match.

Effort: about 2–3 days. Every existing design works in every pose with no new artwork.

### Photo 3D (most photoreal, costly)
Each pose is a new photo set. Run pipeline stages 1–6 in `mehndi-3d-tryon/`: bare hands in the new pose, then each design as paste and as stain. That's 13 Codex images for each pose, about 30–40 minutes, and each new pose adds about 4 MB.
Recommendation: add only **Back of hand** (pose 2) to Photo 3D. Leave the other poses to the 3D model.

## 4. Suggested order

1. **Now:** review the skin-tone pass on real phones (iOS Safari and Android Chrome).
2. **Week 1:** rest-position attribute and pose system in the 3D model (poses 2, 3 and 5), plus the chip row.
3. **Week 2:** Photo 3D back-of-hand set (pose 2).
4. **Later:** namaste and wrist-turn poses, and a real 3D foot model.
5. **Optional upgrade:** a scanned hand (V-ARM 03, paid) to replace the MakeHuman base for pore-level realism. See `3D_IMPLEMENTATION.md`, "Upgrading to a scanned hand".
