# Beautiful realistic hand + self-improving mehndi capture — research and proposed architecture

Status: **Phase 1 in progress.** Written 2026-11-25.

Built so far (Phase 1, capture side):
- **Migration `006_capture_sources.sql`.**
  - `capture_sources` holds the original photo, its hash and size, the uploader, the rights confirmation and a separate training-consent flag.
  - `capture_runs` holds the method, the parameters, the auto-detected and final landmarks, the photo-space brush layer and the frame version.
  - `design_assets` gains `frame_version` and `capture_run_id`.
- **Importer (`src/components/admin/PhotoDesignImporter.tsx`):**
  - drag any of the 21 hand points to fix it;
  - "Place points by hand" (with "Turn points upside down") when MediaPipe finds no hand;
  - Paint / Erase brush on the extracted henna.
  - Brush strokes are stored in **photo space** through the warp's inverse mapping (`toSource`, `paintEdit` in `src/lib/photo-import/warp.ts`).
- **Rebuild tool** at `/admin/designs/reproject`. It re-warps every photo design from its stored original, landmarks and brush layer for the current `frameVersion` in `hand-landmarks.json`, then records a new capture run.
- **Tests:**
  - unit: `tests/unit/photo-warp.test.ts` (inverse mapping, brush add/erase through the warp);
  - end to end: `scripts/out/capture-e2e.py`. It covers both the detected and the placed-by-hand paths, through save and rebuild.
- **Production note:** originals are stored with `storeImage(…, "captures")`. Before collecting real customer or artist photos, point captures at a **private** storage bucket.
Scope: (1) what makes a woman's hand read as beautiful and how to get there technically, (2) how the
photo → design → 3D engine stays compatible, (3) how to add ML that repairs, completes and learns from
mehndi photos over time.

---

## 1. What the current engine does (audit)

| Step | Today | File |
|---|---|---|
| Capture | Admin uploads one photo per side (palm or back) | `src/components/admin/PhotoDesignImporter.tsx` |
| Hand landmarks | MediaPipe HandLandmarker (21 points), retries at 0° / 180°, confidence 0.3 | same |
| Warp | 2D thin-plate spline from photo landmarks to the hand's projection frame (0..1000) | `src/lib/photo-import/warp.ts` |
| Henna extraction | Hand-tuned rule: "darker **and** redder than local skin", two passes of a local mean | `extractHenna()` in `warp.ts` |
| Storage | The **warped** mask + warped photo saved as `design_assets` (`palm` / `palm_photo`) | `createDesignFromPhotoAction` in `src/app/admin/actions.ts` |
| 3D | Mask projected onto the hand in bind-pose object space, stain shading in the shader | `src/components/hand/mehndiMaterial.ts`, `HandScene.tsx` |

Weak points found:

1. **Landmark detection fails** on dense-henna palms and full-forearm photos. The henna breaks up skin cues, so MediaPipe loses the hand, and there is no way to fix the points by hand.
2. **The rule-based extractor** confuses shadows, creases, dark skin, bangles and sleeves with henna. It also misses faded or orange stain.
3. **The flat 2D warp** ignores finger curl and foreshortening. Curled or angled fingers smear.
4. **Missing areas stay missing.** Nothing fills parts hidden by other fingers, outside the frame or lost to glare.
5. **The output is destructive.** Only the warped result is stored, in a frame tied to *today's* mesh. If the hand changes shape (longer fingers, §2), every imported design is misaligned, and the source photo and landmarks needed to redo it are gone.
6. **Nothing learns.** Every admin correction is lost.

Point 5 matters most for this proposal: **a new hand and a learning system both need the raw inputs kept.**

---

## 2. What makes a woman's hand read as beautiful

### Evidence (perception research)
- **Long fingers** make hands more attractive for both sexes. **Smooth skin** matters *more* for female hands than for male hands (Kościński 2011; Saino et al. 2006 on index and ring finger length).
- The 2D:4D finger ratio did **not** reliably predict hand attractiveness in those studies. Overall length and slenderness matter, not one ratio.
- People prefer **feminine shape** in women's hands and arms: narrow palm, slim wrist, tapering fingers (Dane 2010).

### Anthropometry (to stay realistic, not alien)
- Adult women in a 785-person sample: median hand length **16.6 cm** and palm length **9.23 cm**. The palm is about **56 %** of the hand, so the fingers are about 44 % (Chaurand et al. 2007).
- Hands of Indian women measured smaller than Western samples (Nag et al. 2003). Our audience is Hyderabad, so keep the overall scale petite.
- **Target for the "beautiful" variant:** fingers at about 46–48 % of hand length. That means lengthening the phalanges 6–10 %, with the middle phalanx taking most of it.
  - Taper each finger about 15 % from base to tip.
  - Make the wrist 5–8 % narrower than today.
  - Use oval nail beds with a short natural free edge.
  - Going beyond these numbers starts to look uncanny.

### Visual cues that sell "real and beautiful" (from the earlier realism passes)
- **Skin:** even, warm tone with gentle subsurface glow at fingertips and finger edges. Fine creases at joints, but soft. Visible but small pores. Slightly pinker palms. Light sheen only on the high points.
- **Avoid:** knuckle wrinkles that are too deep, prominent veins, visible tendons, harsh speculars, waxy uniform colour.

---

## 3. Technology options for the hand

| Option | Realism | Commercial licence | Works with our henna engine | Verdict |
|---|---|---|---|---|
| **A. Keep the CC0 MakeHuman hand, reshape it with shape keys and bone lengths, and bake a purchased real hand scan's textures onto it** | High: real scanned pores and colour at up to 16K | Yes: CC0 mesh, and a paid scan licence that must be confirmed per product | **Yes.** Same rig and pipeline. Regenerate `hand-landmarks.json` with the existing script | **Recommended** |
| B. Replace with a purchased scan mesh entirely (3D Scan Store, CGTrader) | Highest | Yes (paid) | Needs re-rigging and a new projection frame, so more work | Fallback if A's texture bake falls short |
| C. MANO, NIMBLE, HaMeR or WiLoR research hand models | High | **No.** MANO and WiLoR are non-commercial; NIMBLE's terms are unclear and its textures come from third-party assets | Yes | **Ruled out** for a commercial site |
| D. Gaussian-splat or NeRF capture of a real model's hand | Photoreal | Yes, with the model's written consent | **Poor.** Hard to project henna onto, can't re-pose, heavy on mobile | Later, only for marketing renders |

**Option A in practice:**
1. Buy one female hand scan close to our audience's skin tone. 3D Scan Store female hand scans ship 16K colour, displacement, specular and normal maps, and cost about £11–25 (check the licence on the product page before buying).
2. Reshape the MakeHuman hand to the §2 targets in Blender, driven by script in `scripts/hand-real/build_hand.py`.
3. Bake the scan's colour and displacement onto our UVs by projection.
4. Run `scripts/hand-real/extract-landmarks.mjs` to regenerate the projection frame.
5. Re-run the design generators (`pnpm artwork:generate`, `scripts/hand-real/photo_transfer.py`).

**Delivery so 4K detail doesn't kill mobile:**
- Ship the textures as **KTX2 / Basis Universal** (three.js `KTX2Loader`). A 4K map then costs about 3–5 MB in GPU memory instead of 64 MB, downloads smaller than JPEG and stays sharp at zoom.
- Keep 2K for low-tier phones (`pickQuality()` already exists).
- Draw henna as **vector strokes** (§5.4) instead of raster masks, so close-up zoom has no resolution ceiling.

---

## 4. Keeping the photo → design engine compatible (key change)

Make the pipeline **non-destructive and mesh-independent**:

```
photo (original, kept) ──► landmarks (21 pts, kept, editable) ──► hand mask ──► henna mask / strokes (kept, in PHOTO space)
                                                                                         │
                                       per-mesh "projection frame" (hand-landmarks.json v1, v2, …)
                                                                                         ▼
                                                              warp/project at build time ──► design_assets (derived, cache)
```

- Store the source photo, the landmarks and the extracted henna **in photo space**.
- `design_assets` becomes a *derived cache*, keyed by `frame_version`.
- When the hand mesh changes (beautiful variant, new poses), a script re-projects every design automatically. No admin re-upload.
- The existing mapping from MediaPipe's 21 points to our joints (`MP_TO_JOINT`) stays valid for any mesh rigged with the same joint names.

Later upgrade: **3D projection instead of a 2D warp.**
- Fit our own rig's pose to MediaPipe's *world* landmarks with simple inverse kinematics (bend each joint to match).
- Project the photo onto the posed mesh's UVs.
- This fixes curled and angled fingers. It uses only our CC0 rig, so MANO is not needed.

---

## 5. ML architecture: extract → repair → complete → learn

### 5.1 Pipeline stages

| # | Stage | Model / method | Licence | Runs where |
|---|---|---|---|---|
| 0 | **Guided capture** | Camera overlay with live checks: sharpness, exposure, whole hand in frame, MediaPipe confidence. Palm and back captured separately | Own code | Browser (admin, artist, later customers) |
| 1 | Landmarks | MediaPipe HandLandmarker (current), plus **manual drag-to-fix of the 21 points** when confidence is low | Apache-2.0 | Browser |
| 2 | Hand mask | **SAM 2.1 tiny**, prompted with the landmarks. Excludes sleeves, bangles and background | Apache-2.0 (confirm in Meta's repo) | Browser (WebGPU, about 150 MB, admin only) or a small server worker |
| 3 | **Henna segmentation** | Small U-Net with a pretrained MobileNetV3 or EfficientNet-lite encoder, trained on our data, exported to ONNX (about 5–15 MB at fp16) | Own weights. Check the encoder weights' licence. Avoid SegFormer and RMBG-2.0, believed non-commercial | Browser via `onnxruntime-web` (MIT; WebGPU, WASM fallback) |
| 4 | Vectorise | Skeletonise the mask to centre-lines plus per-point width, then fit Bézier strokes | Own code | Browser or worker |
| 5 | **Repair and complete** | See §5.4 | — | Worker, with admin approval |
| 6 | Project to the 3D hand | Current warp, then 3D projection (§4) | Own code | Build or worker |

Today's rule-based `extractHenna()` stays useful:
- it produces **pseudo-labels** to bootstrap training;
- it is the **fallback** when the model can't load.

### 5.2 Where training data comes from (and the rights rule)

The project rule is *no copyrighted artwork without permission*. Mehndi photos scraped from the internet belong to their photographers and artists, so they are **not** used for training. Sources:

1. **Synthetic data (unlimited, perfectly labelled, available on day one).** We own the procedural design generator and the 3D hand.
   - Render thousands of photos: random designs × skin tones (`PHOTO_TONES`) × lighting × camera angles × blur, noise and JPEG artefacts × stain colours from fresh orange to day-2 maroon.
   - Each render comes with its exact henna mask.
   - This teaches the model what henna is versus a crease or a shadow.
2. **Artist uploads with consent.** The artist portal in `docs/ARTIST_PLATFORM_PLAN.md` adds portfolio uploads with an opt-in checkbox: "allow VAISHORA to use this photo to improve design detection". These photos serve as portfolio and dataset at once.
3. **Admin corrections.** Every brush fix and landmark fix in the importer becomes a gold label.
4. Photos the owner commissions or shoots.

How much data is enough:
- **Segmentation:** a few hundred real labelled photos plus synthetic data is enough for a good model, because the encoder is pretrained.
- **Learned completion (§5.4 c):** needs thousands. That's why the deterministic methods come first.

### 5.3 The learning loop ("store it, improve next time")

```
upload ─► run pipeline (model vN) ─► review queue (low-confidence regions highlighted) ─► admin fixes with brush / landmark drag
   ▲                                                                                              │
   │                                                     corrections saved as gold labels ◄───────┘
   │                                                                │
   └── model vN+1 promoted only if it beats vN on the held-out gold set ◄── scheduled training job (Python/PyTorch)
```

**New tables (one migration):**
- `capture_sources`: original photo URL and hash, uploader, side, consent flags, licence notes.
- `capture_runs`: source, model version, parameters, auto mask, strokes, confidence map, timing.
- `capture_labels`: approved mask, strokes, landmarks; who approved it; diff against the auto result.
- `ml_models`: version, task, metrics (IoU, boundary F1, stroke continuity), ONNX URL, status (candidate / live / retired).
- `design_assets` gains `frame_version` and `run_id`, so derived assets can be rebuilt.

**Training job:**
- Lives in `scripts/ml/` (PyTorch), on a local GPU or a rented one. A small U-Net trains in roughly 1 hour on one consumer GPU.
- It reads approved labels plus synthetic data and evaluates on a **frozen gold set**.
- It writes a *candidate* model. Promotion to *live* is a button in the admin panel, never automatic.

**Active learning:**
- The review queue sorts by model uncertainty, so admin time goes to the photos the model learns most from.
- **Batch import ("feed hundreds of photos"):** an admin screen takes a folder, runs the pipeline on each photo and fills the review queue.

### 5.4 Completing missing or broken designs

Ordered from most reliable to most creative. Each later step is used only when the earlier ones can't fill the gap.

**a. Structure-aware fill (deterministic, explainable, works now).** Mehndi is highly regular.
- **Rotational symmetry:** a polar autocorrelation finds a mandala's order (8-fold, 12-fold and so on). Missing petals are copied from the visible ones.
- **Mirror symmetry:** patterns symmetric about the finger axis or the palm centre-line.
- **Periodicity:** wrist bands and finger bands repeat, so a 1D period estimate extends them.
- **Finger-to-finger repetition:** if index, middle and ring fingers carry the same motif, the pinky or a cut-off finger gets it too.

**b. Motif retrieval.**
- Every approved design is cut into motif patches, and each patch gets an embedding (a small CNN, or CLIP-style image embeddings run locally).
- A gap is filled with the best-matching motif from our own library, warped to fit.
- This is how the system "learns and stores" patterns: the library grows with every approved upload.

**c. Learned inpainting.**
- **LaMa** (Apache-2.0 code), trained on henna masks from our own data and the synthetic set. The public weights were trained on Places, whose terms are research-only, so train our own weights or get legal sign-off before commercial use.
- **FLUX.1 Fill [dev] is non-commercial.** Use it only with a Black Forest Labs licence or through their paid API.

**d. Stroke continuation.** On vector strokes, an unfinished line is continued along its curvature until it reaches the matching motif boundary. This fixes broken lines, glare gaps and small blur areas.

**Honesty rules (the project's no-fake policy):**
- Anything filled in is stored as a separate **"predicted" layer**. It shows in the admin review in a different colour and must be approved.
- The confidence score and the source of the fill (symmetry, retrieval or AI) are kept.
- Customer-facing pages show "design preview" wording.
- A completed design is never presented as a photo of a real client's hand.

---

## 6. Recommended plan

| Phase | Work | Outcome |
|---|---|---|
| **1. Foundation** (~1–2 weeks) | Non-destructive storage (§4) plus migration. Landmark drag-to-fix and mask brush in the importer. Buy the scan and build the beautiful hand variant (§3 A). KTX2 textures | New hand without breaking existing designs. Corrections start being captured |
| **2. Learned extraction** (~2–3 weeks) | Synthetic data renderer. U-Net v1 trained and running in the browser. SAM hand mask. Review queue and metrics | Robust extraction on dense, faded and dark-skin photos |
| **3. Completion** (~2–3 weeks) | Vectorisation, symmetry, periodicity and repetition fill, motif library, predicted-layer UI | Complete designs from partial photos, crisp at any zoom |
| **4. Continuous learning** (ongoing) | Scheduled training, model registry and promotion, active learning, artist opt-in dataset, LaMa on own data, 3D pose projection | The system improves with every upload |

Durations are rough planning figures, not commitments.

## 7. Decisions needed from the owner

1. **Buy the hand scan:** about £11–25 (3D Scan Store) or about $150 for a multi-pose pack. Pick the skin tone, then check the product's commercial licence.
2. **Training compute:** a local GPU machine, or a rented GPU (pay per hour).
3. **Consent policy:** wording of the artist opt-in for training data. Confirm that no scraped internet photos are used.
4. **Who can use capture:** admin only to start; artists next; customers ("upload your own design idea") last.
5. Which viewer stays the default: 3D model, Photo 3D or Realistic 3D.

## Sources
- Kościński 2011, hand attractiveness: https://gwern.net/doc/psychology/man-hands/2011-koscinski.pdf · https://journals.sagepub.com/doi/10.1068/p6960
- Saino et al. 2006, digit length and hand attractiveness: https://gwern.net/doc/psychology/man-hands/2006-saino.pdf
- Dane 2010, hand masculinity and femininity preferences: https://digitalrepository.unm.edu/psy_etds/33
- Hand anthropometry tables: https://pmc.ncbi.nlm.nih.gov/articles/PMC10308009/table/T1 · Nag et al. 2003: https://www.ece.uvic.ca/~bctill/papers/mocap/Nag_etal_2003.pdf
- NIMBLE: https://github.com/reyuwei/NIMBLE_model · https://arxiv.org/abs/2202.04533
- WiLoR (CC BY-NC-ND; needs MANO): https://github.com/rolpotamias/WiLoR · HaMeR: https://arxiv.org/html/2312.05251v1
- Hand scans: https://www.3dscanstore.com/hand-3d-model/all-model-hands-section/female-3d-hand-model-asian-60 · https://www.turbosquid.com/3d-models/22-female-single-hands-poses-model-2200487 · https://www.renderhub.com/thecatempire/v-arm-03
- SAM 2.1 ONNX / WebGPU: https://huggingface.co/vietanhdev/segment-anything-2.1-onnx-models · https://github.com/Xevion/WebSAM
- onnxruntime-web (MIT, WebGPU): https://npmjs.com/package/onnxruntime-web · https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/
- RMBG-2.0 (CC BY-NC): https://huggingface.co/yamura4/RMBG-2.0-WebGPU
- LaMa: https://huggingface.co/smartywu/big-lama/blob/main/README.md · https://huggingface.co/Carve/LaMa-ONNX
- FLUX.1 Fill [dev] licence: https://huggingface.co/black-forest-labs/FLUX.1-Fill-dev · https://bfl.ai/legal/non-commercial-license-terms
- No public mehndi segmentation dataset found; closest method survey: https://arxiv.org/pdf/2206.00356
