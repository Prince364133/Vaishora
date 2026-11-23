# Mehndi 3D Try-On: complete system

A website that shows photoreal 3D hands (traced from your reference photo) with switchable mehndi designs:
fresh paste or dried stain, four skin tones, drag to rotate, scroll to zoom, and download.
This package holds the finished site, every pipeline stage that produced it, the Codex images and prompts,
your references, and all intermediate data, so you can rebuild it or add designs.

---

## 1. Open the site

- **Double-click `index.html`.** It's a single file (about 5 MB) and works in Chrome, Edge, Safari and Firefox.
  It needs internet only for the Three.js 3D library and the fonts.
- Or run `sh run_preview.sh` and open http://localhost:8765
- `lineart.html` is the first 3D version, with designs drawn in code instead of photos (stage 2).

---

## 2. What's inside

```
mehndi-3d-tryon/
├── index.html                  ← the finished try-on site (photoreal)
├── lineart.html                ← first version: 3D hands + drawn designs
├── run_preview.sh              ← local web server
├── reference/
│   ├── reference.webp          ← your original photo (hand shape + pose)
│   ├── style-references.md     ← the 4 style photos you sent and which preset each became
│   └── feedback-screenshots/   ← your screenshots that led to the stage-4 rebuild
├── generated-images/           ← every Codex image (JPEG): bare hands + 6 designs × paste/stain
│   └── prompts/                ← the exact prompt sent to Codex for each image
├── pipeline/
│   ├── requirements.txt        ← Python packages
│   ├── common.py               ← shared paths, segmentation, alignment, Codex call
│   ├── hand_shape.py           ← parametric left hand (polygon + finger capsules)
│   ├── s1_segment_reference.py ← stage 1a
│   ├── s1_trace_hand.py        ← stage 1b
│   ├── s2_lineart_heights.py   ← stage 2a
│   ├── s2_build_lineart.py     ← stage 2b
│   ├── s3_generate_images.py   ← stage 3 (Codex)
│   ├── s4_photo_geometry.py    ← stage 4
│   ├── s5_textures.py          ← stage 5
│   ├── s6_build_site.py        ← stage 6
│   ├── mehndi.py               ← design tool: add / list / remove / build
│   ├── rebuild_all.sh          ← run every stage in order
│   └── templates/              ← site_template.html (photo site), lineart_template.html
└── data/
    ├── designs.json            ← the design list shown on the page (name, card text, style, photos)
    ├── config.json             ← frames and sizes used by the stages
    ├── stage1/ stage2/ stage4/ ← intermediate results (masks, traced outline, height maps, checks)
    ├── designs/<id>/           ← per design: paste/stain texture atlas, card thumbnail, alignment check
    └── background.jpg          ← silk backdrop (hands removed)
```

---

## 3. How the system works

```
reference.webp ─► 1 trace the hands ─► 2 first 3D version (drawn designs) ─► lineart.html
                        │
                        ▼
              3 Codex: bare hands in the same pose ─► Codex: each design as fresh paste ─► Codex: same design as dried stain
                        │                                         │
                        ▼                                         ▼
              4 3D shape from the bare-hands photo     5 line each photo up with the bare hands ─► textures
                        └──────────────────────────────┬──────────┘
                                                       ▼
                                   6 index.html: Three.js mesh + photo texture + photo backdrop
```

| Stage | Script | Input → Output | What it does |
|---|---|---|---|
| 1a | `s1_segment_reference.py` | reference.webp → `stage1/ref_mask_L/R.png` | Cuts each hand out of your photo with **GrabCut**, seeded by rough outlines read off a pixel grid. |
| 1b | `s1_trace_hand.py` | ref masks → `stage1/traced_*.png`, `right_hand_affine.npy` | Fits a clean parametric left hand (palm polygon and tapered finger capsules). The right hand is the mirror, turned −4.17° by **ECC alignment** (95% overlap with your photo). |
| 2a | `s2_lineart_heights.py` | traced hand → `stage2/hmap.b64`, `hand.json` | Makes 3D heights by **Poisson inflation** (conjugate-gradient solve), log-compressed so the forearm, wrist, palm and fingers get realistic thickness, plus a palm hollow and thumb/pinky mounds. |
| 2b | `s2_build_lineart.py` | → `lineart.html` | First 3D site: six designs drawn in code (canvas), procedural silk, petals. |
| 3 | `s3_generate_images.py` | reference / bare photo → `generated-images/*.jpg` | **Codex CLI image generation.** Removes the mehndi from your photo (same pose), adds each design as fresh paste, then the same design as dried stain. Royal Bridal: stain from your photo, then back to paste. |
| 4 | `s4_photo_geometry.py` | bare-hands.jpg → `stage4/hmap.png`, `mask.png`, `geo.json` | Builds the final 3D shape **from the photo itself**: places it on the canvas, cuts out both hands, finds the dark seams between touching fingers, inflates each finger separately, then feathers the edges. |
| 5 | `s5_textures.py` | design photos → `designs/<id>/*_atlas.jpg` | Lines each design photo up with the bare-hands photo (GrabCut + several ECC fits + optional optical flow; keeps the best overlap, typically 95–99%), pushes skin colour past the edges, fades the forearm above the photo into bare skin, makes thumbnails and the backdrop. |
| 6 | `s6_build_site.py` | everything → `index.html` | Packs the height map, cut-out mask, textures and thumbnails into one HTML file using the template. |

### How the 3D page renders
- **One mesh for both hands:** a 312 × 665 grid (4 px cells) raised by the height map. Triangles outside the hands are dropped, and the exact photo outline cuts the edge (alpha test + alpha-to-coverage antialiasing).
- **Photo realism:** the design photo is used as both the colour and a self-lit (emissive) layer, about 50/50. The straight-on view matches the photograph, and the key light and shadows add real 3D shading when you tilt. Tone mapping is off so photo colours stay true.
- **Skin tones** are a colour multiplier over the photo. **Backdrop** is the bare photo with the hands painted out, softly extended past its edges.
- **Controls:** OrbitControls (rotate ±52°, zoom, pan), Showcase sway, Reset view, Download PNG.
- **Remembered between visits:** the last design, look and tone (localStorage).

---

## 4. Packages, tools and services used

| What | Version | Used for |
|---|---|---|
| Python | 3.10.14 | all pipeline stages |
| opencv-python | 4.9.0 | GrabCut, ECC alignment, Farneback optical flow, distance transforms, inpainting, image I/O |
| numpy | 1.26.4 | Poisson solve (conjugate gradient), height maps, masks |
| Codex CLI (OpenAI) | 0.165.0, `image_generation` feature, ChatGPT login | generated every photo in `generated-images/` (stage 3) |
| three.js | 0.160.0 from cdn.jsdelivr.net | WebGL rendering, `OrbitControls`, `RoomEnvironment` |
| Google Fonts | Cormorant Garamond, Jost | page typography |
| Python `http.server` | built in | local preview |

Install the Python packages with `python3 -m pip install -r pipeline/requirements.txt`.
Pillow and SciPy were tried during development but aren't needed.

---

## 5. Add your own designs

Run from this folder. Codex must be installed and logged in (`codex login`) for generated designs.

```bash
# Codex generates fresh paste + dried stain, aligns them, and rebuilds index.html (about 4-6 minutes)
python3 pipeline/mehndi.py add "Lotus Bloom" --style "A large lotus mandala in each palm with fine petals, dotted rings and leafy vines up the fingers" --tag "Lotus & dots"

# copy the style of a mehndi photo you have
python3 pipeline/mehndi.py add "Like My Photo" --style "Same style as the reference" --ref /path/to/mehndi.jpg

# use photos you already have (they must show the same pose as generated-images/bare-hands.jpg)
python3 pipeline/mehndi.py add "Client Pick" --paste paste.jpg --stain stain.jpg

python3 pipeline/mehndi.py list
python3 pipeline/mehndi.py remove lotus-bloom
python3 pipeline/mehndi.py build        # rebuild index.html after editing data/designs.json (names, order, card text)
```

After adding a design, look at `data/designs/<id>/paste_check.jpg`. The cyan line is the 3D hand outline and should sit on the photo's hands.
Photos that match below 90% are rejected unless you add `--force`.

---

## 6. Rebuild everything from scratch

```bash
sh pipeline/rebuild_all.sh               # stages 1, 2, 4, 5, 6 from the files in this package (about 6 minutes)
sh pipeline/rebuild_all.sh --with-codex  # also regenerates every image with Codex (NEW images, about 30 minutes extra)
```

---

## 7. Known limits

- Both hands share one photo per design. If Codex changes a finger noticeably, stage 5 lines it up at about 95% and the edges can stretch slightly; check `*_check.jpg`.
- Above the top edge of the photo the forearms fade to bare skin, which you'll see at steep tilts.
- The back of the hands isn't modelled. The view is limited to the palm side, like the photo.
- Each new design adds about 0.6 MB to `index.html`.
- Codex output varies from run to run, so regenerating gives different (but similar) images.
