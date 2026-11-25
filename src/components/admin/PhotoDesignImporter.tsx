"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDesignFromPhotoAction, type ActionState } from "@/app/admin/actions";
import { emptyEdits, FRAME_VERSION, paintEdit, Pt, Side } from "@/lib/photo-import/warp";
import { canvasBlob, dataBlob, Extractor, imageData, normaliseSource, OUT, SourceResult, templatePoints, warpSource } from "@/lib/photo-import/browser";
import { loadHennaModel } from "@/lib/photo-import/henna-model";

const MP_VERSION = "1.2.3";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const PREVIEW_W = 900;

type Detected = { pts: Pt[]; label: string; score: number };
type Brush = "off" | "add" | "erase";

// Finger chains for drawing the skeleton over the photo (MediaPipe landmark order).
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

function draw(canvas: HTMLCanvasElement | null, d: ImageData | null, bg?: string) {
  if (!canvas || !d) return;
  canvas.width = d.width;
  canvas.height = d.height;
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, d.width, d.height);
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, d.width, d.height);
  }
  const t = document.createElement("canvas");
  t.width = d.width;
  t.height = d.height;
  t.getContext("2d")!.putImageData(d, 0, 0);
  g.drawImage(t, 0, 0);
}

/** Pointer position in a canvas's own pixel coordinates. */
function canvasPoint(c: HTMLCanvasElement, e: React.PointerEvent): Pt {
  const r = c.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
}

/**
 * Admin: turn a photo of a hand with mehndi into a new design.
 *  1. MediaPipe Hands (in the browser) finds 21 landmarks; the admin can drag any point to fix it, or
 *     place all points by hand when no hand is detected.
 *  2. The photo is warped onto our 3D hand's palm/back frame and the henna is extracted.
 *  3. The admin can paint henna in or out with a brush. Brush strokes are stored in PHOTO space.
 *  4. The original photo, landmarks, parameters and brush layer are saved with the design, so it can be
 *     rebuilt for a new hand mesh and later used (with consent) to train better detection.
 */
export function PhotoDesignImporter({ categories }: { categories: { slug: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createDesignFromPhotoAction, null);
  const [source, setSource] = useState<{ canvas: HTMLCanvasElement; data: ImageData } | null>(null);
  const [hands, setHands] = useState<Detected[]>([]);
  const [handIdx, setHandIdx] = useState(0);
  const [pts, setPts] = useState<Pt[] | null>(null);
  const [manual, setManual] = useState(false);
  const [ptsEdited, setPtsEdited] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [side, setSide] = useState<Side>("palm");
  const [sensitivity, setSensitivity] = useState(0.5);
  const [status, setStatus] = useState("");
  const [extractor, setExtractor] = useState<Extractor>("model");
  const [modelState, setModelState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [brush, setBrush] = useState<Brush>("off");
  const [brushSize, setBrushSize] = useState(18);
  const [editsVersion, setEditsVersion] = useState(0);
  // identity of the inputs a result was computed from (lets the UI show "Detecting…" without extra state)
  const inputs = useMemo(() => ({ editsVersion }), [source, pts, side, sensitivity, editsVersion, extractor]); // eslint-disable-line react-hooks/exhaustive-deps
  const [result, setResult] = useState<(SourceResult & { inputs: object }) | null>(null);
  const edits = useRef<ImageData | null>(null);
  const editsTouched = useRef(false);
  const dragging = useRef<number | null>(null);
  const painting = useRef(false);
  const srcCanvas = useRef<HTMLCanvasElement>(null);
  const photoCanvas = useRef<HTMLCanvasElement>(null);
  const maskCanvas = useRef<HTMLCanvasElement>(null);

  const resetEdits = useCallback((w: number, h: number) => {
    edits.current = emptyEdits(w, h);
    editsTouched.current = false;
    setEditsVersion((v) => v + 1);
  }, []);

  // 1. load + detect hands when a photo is chosen
  async function onFile(f: File | null) {
    setHands([]);
    setPts(null);
    setResult(null);
    setManual(false);
    setPtsEdited(false);
    setSource(null);
    if (!f) return;
    try {
      setStatus("Loading hand detection…");
      const url = URL.createObjectURL(f);
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = normaliseSource(image);
      URL.revokeObjectURL(url);
      const W = canvas.width;
      const H = canvas.height;
      setSource({ canvas, data: imageData(canvas, W, H) });
      resetEdits(W, H);
      if (modelState === "idle") {
        // load the learned henna detector in the background while the hand is being found
        setModelState("loading");
        loadHennaModel().then((m) => {
          setModelState(m ? "ready" : "unavailable");
          if (!m) setExtractor("rules");
        });
      }
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM);
      const hl = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL },
        numHands: 2,
        runningMode: "IMAGE",
        minHandDetectionConfidence: 0.3,
        minHandPresenceConfidence: 0.3,
      });
      setStatus("Finding the hand…");
      // Fingers-down photos (common for mehndi) detect better upright: try as-is, then rotated 180°.
      const rc = document.createElement("canvas");
      rc.width = W;
      rc.height = H;
      const rg = rc.getContext("2d")!;
      rg.translate(W, H);
      rg.rotate(Math.PI);
      rg.drawImage(canvas, 0, 0);
      let found: Detected[] = [];
      let rot = false;
      for (const a of [{ src: canvas, rot: false }, { src: rc, rot: true }]) {
        const res = hl.detect(a.src);
        found = res.landmarks.map((lm, i) => ({
          pts: lm.map((p) => (a.rot ? [W - p.x * W, H - p.y * H] : [p.x * W, p.y * H]) as Pt),
          label: res.handedness[i]?.[0]?.categoryName ?? "",
          score: res.handedness[i]?.[0]?.score ?? 0,
        }));
        rot = a.rot;
        if (found.length) break;
      }
      hl.close();
      if (!found.length) {
        setStatus("No hand found automatically. Use “Place points by hand” and drag each point onto the matching joint.");
        return;
      }
      setRotated(rot);
      setHands(found);
      setHandIdx(0);
      setPts(found[0].pts);
      setStatus(`Found ${found.length} hand${found.length > 1 ? "s" : ""}. Drag any point that is off, then check the preview.`);
    } catch (e) {
      setStatus(`Hand detection failed: ${e instanceof Error ? e.message : typeof e === "string" ? e : "could not load the detector (check the internet connection)"}. You can still place the points by hand.`);
    }
  }

  function placeManually() {
    if (!source) return;
    setManual(true);
    setPtsEdited(true);
    setPts(templatePoints(side, source.data.width, source.data.height));
    setStatus("Drag each point onto the matching joint: wrist, then each finger from knuckle to tip.");
  }

  // 2. warp + extract whenever the inputs change (not while a point is being dragged)
  useEffect(() => {
    if (!source || !pts) return;
    let cancelled = false;
    warpSource(source.data, pts, side, sensitivity, edits.current, extractor)
      .then((r) => !cancelled && setResult({ ...r, inputs }))
      .catch((e) => setStatus(`Could not process the photo: ${(e as Error).message}`));
    return () => {
      cancelled = true;
    };
  }, [source, pts, side, sensitivity, extractor, inputs]);
  const working = !!source && !!pts && result?.inputs !== inputs;

  // source preview with draggable points
  const drawSource = useCallback(
    (live: Pt[] | null) => {
      const c = srcCanvas.current;
      if (!source || !c) return;
      const k = Math.min(1, PREVIEW_W / source.data.width);
      c.width = Math.round(source.data.width * k);
      c.height = Math.round(source.data.height * k);
      const g = c.getContext("2d")!;
      g.drawImage(source.canvas, 0, 0, c.width, c.height);
      hands.forEach((h, i) => {
        if (i === handIdx) return;
        g.fillStyle = "rgba(255,255,255,.6)";
        h.pts.forEach(([x, y]) => {
          g.beginPath();
          g.arc(x * k, y * k, 3 * ((c.width / (c.getBoundingClientRect().width || c.width)) || 1), 0, Math.PI * 2);
          g.fill();
        });
      });
      const p = live ?? pts;
      // draw at a constant on-screen size, whatever the preview is scaled to
      const css = c.getBoundingClientRect().width;
      const u = css > 0 ? c.width / css : 1;
      if (!p) return;
      g.strokeStyle = "rgba(212,175,124,.85)";
      g.lineWidth = 2 * u;
      for (const [a, b] of BONES) {
        g.beginPath();
        g.moveTo(p[a][0] * k, p[a][1] * k);
        g.lineTo(p[b][0] * k, p[b][1] * k);
        g.stroke();
      }
      p.forEach(([x, y], i) => {
        g.beginPath();
        g.arc(x * k, y * k, (i === 0 ? 7 : 6) * u, 0, Math.PI * 2);
        g.fillStyle = i === 0 ? "#4b1d3f" : "#d4af7c";
        g.fill();
        g.strokeStyle = "#fff";
        g.lineWidth = 1.5 * u;
        g.stroke();
      });
    },
    [source, hands, handIdx, pts],
  );
  useEffect(() => drawSource(null), [drawSource]);

  const livePts = useRef<Pt[] | null>(null);
  function onSrcDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pts || !source) return;
    const c = e.currentTarget;
    const k = c.width / source.data.width;
    const [x, y] = canvasPoint(c, e);
    let best = -1;
    let bd = (18 * c.width) / c.getBoundingClientRect().width; // 18 css px grab radius
    pts.forEach(([px, py], i) => {
      const d = Math.hypot(px * k - x, py * k - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best < 0) return;
    dragging.current = best;
    livePts.current = pts.map((p) => [...p] as Pt);
    c.setPointerCapture(e.pointerId);
  }
  function onSrcMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragging.current === null || !livePts.current || !source) return;
    const c = e.currentTarget;
    const k = c.width / source.data.width;
    const [x, y] = canvasPoint(c, e);
    livePts.current[dragging.current] = [Math.max(0, Math.min(source.data.width - 1, x / k)), Math.max(0, Math.min(source.data.height - 1, y / k))];
    drawSource(livePts.current);
  }
  function onSrcUp() {
    if (dragging.current === null || !livePts.current) return;
    dragging.current = null;
    setPts(livePts.current);
    setPtsEdited(true);
    livePts.current = null;
  }

  // previews
  useEffect(() => {
    draw(photoCanvas.current, result?.photo ?? null, "#4b1d3f");
    draw(maskCanvas.current, result ? tintMask(result.mask) : null, "#f2d3c4");
  }, [result]);

  // brush on the henna preview → painted into the photo-space edit layer through the inverse warp
  function dab(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!result || !edits.current || brush === "off") return;
    const c = e.currentTarget;
    const [x, y] = canvasPoint(c, e);
    const r = (brushSize * OUT) / 1000;
    const [sx, sy] = result.toSource(x, y);
    const [ox, oy] = result.toSource(x + r, y);
    const sr = Math.max(1.5, Math.hypot(ox - sx, oy - sy));
    paintEdit(edits.current, sx, sy, sr, brush);
    editsTouched.current = true;
    // instant feedback on the preview; the real result is recomputed on release
    const g = c.getContext("2d")!;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = brush === "add" ? "rgba(91,31,15,.85)" : "#f2d3c4";
    g.fill();
  }
  function onMaskDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (brush === "off") return;
    painting.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    dab(e);
  }
  function onMaskMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (painting.current) dab(e);
  }
  function onMaskUp() {
    if (!painting.current) return;
    painting.current = false;
    setEditsVersion((v) => v + 1);
  }

  async function submit(fd: FormData) {
    if (!result || !source || !pts) return;
    fd.set(`art_${side}`, new File([await dataBlob(result.mask)], `${side}-mask.webp`, { type: "image/webp" }));
    fd.set(`photo_${side}`, new File([await dataBlob(result.photo)], `${side}-photo.webp`, { type: "image/webp" }));
    // original photo: highest JPEG quality that stays under the upload limit
    let original = await canvasBlob(source.canvas, "image/jpeg", 0.92);
    for (const q of [0.88, 0.84, 0.78, 0.7]) {
      if (original.size <= 2.9 * 1024 * 1024) break;
      original = await canvasBlob(source.canvas, "image/jpeg", q);
    }
    fd.set("source", new File([original], "source.jpg", { type: "image/jpeg" }));
    if (editsTouched.current && edits.current) fd.set("edits", new File([await dataBlob(edits.current, "image/png")], "edits.png", { type: "image/png" }));
    fd.set("source_w", String(source.data.width));
    fd.set("source_h", String(source.data.height));
    fd.set("landmarks", JSON.stringify(pts.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)])));
    fd.set("auto_landmarks", manual || !hands[handIdx] ? "null" : JSON.stringify(hands[handIdx].pts.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)])));
    fd.set("landmarks_edited", ptsEdited ? "1" : "0");
    fd.set("params", JSON.stringify({ sensitivity, handIdx, rotated, manual, method: result.method, uncertainty: result.uncertainty }));
    fd.set("frame_version", String(FRAME_VERSION));
    fd.set("region", side);
    action(fd);
  }

  const chip = (on: boolean) => `chip ${on ? "!bg-plum !text-ivory" : ""}`;

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2 className="font-sans text-base font-semibold">1. Upload a mehndi photo</h2>
        <p className="mt-1 text-sm text-muted">
          One hand with the whole palm (or back) and all fingers visible, good light, little blur. Left or right hand both work. Use only photos you own or have
          permission to use.
        </p>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-3 text-sm" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        {status && <p className="mt-2 text-sm text-muted" role="status">{status}</p>}
        {source && (
          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <figure>
              <canvas
                ref={srcCanvas}
                className="w-full touch-none rounded-[var(--radius-sm)] bg-blush"
                style={{ cursor: pts ? "grab" : "default" }}
                onPointerDown={onSrcDown}
                onPointerMove={onSrcMove}
                onPointerUp={onSrcUp}
                onPointerCancel={onSrcUp}
                aria-label="Photo with hand points. Drag a point to move it."
              />
              <figcaption className="mt-1 text-xs text-muted">Hand points: drag any point onto its joint (dark dot = wrist)</figcaption>
            </figure>
            <figure>
              <canvas ref={photoCanvas} className="aspect-square w-full rounded-[var(--radius-sm)]" />
              <figcaption className="mt-1 text-xs text-muted">Photo fitted to our 3D hand ({side})</figcaption>
            </figure>
            <figure>
              <canvas
                ref={maskCanvas}
                className="aspect-square w-full touch-none rounded-[var(--radius-sm)]"
                style={{ cursor: brush === "off" ? "default" : "crosshair" }}
                onPointerDown={onMaskDown}
                onPointerMove={onMaskMove}
                onPointerUp={onMaskUp}
                onPointerCancel={onMaskUp}
                aria-label="Extracted henna. Choose Paint or Erase to correct it."
              />
              <figcaption className="mt-1 text-xs text-muted">Extracted henna: use Paint / Erase to correct it</figcaption>
            </figure>
          </div>
        )}
        {source && (
          <div className="mt-4 flex flex-wrap items-end gap-4">
            {!pts && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={placeManually}>
                Place points by hand
              </button>
            )}
            {manual && pts && source && (
              <button
                type="button"
                className="chip"
                onClick={() => {
                  // rotate the template 180° about its centre (for fingers-down photos)
                  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
                  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
                  setPts(pts.map(([x, y]) => [2 * cx - x, 2 * cy - y] as Pt));
                }}
              >
                Turn points upside down
              </button>
            )}
            {hands.length > 1 && (
              <label className="field">
                <span className="label">Hand</span>
                <select
                  className="input w-auto"
                  value={handIdx}
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    setHandIdx(i);
                    setPts(hands[i].pts);
                    setPtsEdited(false);
                  }}
                >
                  {hands.map((h, i) => (
                    <option key={i} value={i}>Hand {i + 1}{h.label ? ` (${h.label.toLowerCase()})` : ""}</option>
                  ))}
                </select>
              </label>
            )}
            {pts && (
              <>
                <fieldset className="field">
                  <legend className="label">This photo shows the</legend>
                  <div className="flex gap-2">
                    {(["palm", "back"] as const).map((s) => (
                      <button key={s} type="button" aria-pressed={side === s} className="chip" onClick={() => setSide(s)}>
                        {s === "palm" ? "Palm" : "Back of hand"}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="field">
                  <legend className="label">Henna detector</legend>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" aria-pressed={extractor === "model"} className={chip(extractor === "model")} disabled={modelState === "unavailable"} onClick={() => setExtractor("model")}>
                      AI model{modelState === "loading" ? " (loading…)" : modelState === "unavailable" ? " (unavailable)" : ""}
                    </button>
                    <button type="button" aria-pressed={extractor === "rules"} className={chip(extractor === "rules")} onClick={() => setExtractor("rules")}>
                      Classic rules
                    </button>
                    {working && <span className="text-xs text-muted" role="status">Detecting henna…</span>}
                    {!working && result?.uncertainty != null && <span className="text-xs text-muted">Unsure on {result.uncertainty}% of the hand</span>}
                  </div>
                </fieldset>
                {extractor === "rules" && (
                  <label className="field min-w-56">
                    <span className="label">Henna detection sensitivity</span>
                    <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} />
                  </label>
                )}
                <fieldset className="field">
                  <legend className="label">Correct the henna</legend>
                  <div className="flex flex-wrap items-center gap-2">
                    {(["off", "add", "erase"] as const).map((b) => (
                      <button key={b} type="button" aria-pressed={brush === b} className={chip(brush === b)} onClick={() => setBrush(b)}>
                        {b === "off" ? "Off" : b === "add" ? "Paint" : "Erase"}
                      </button>
                    ))}
                    <input type="range" min={4} max={60} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} aria-label="Brush size" className="w-24" />
                    <button type="button" className="chip" onClick={() => source && resetEdits(source.data.width, source.data.height)}>
                      Undo all
                    </button>
                  </div>
                </fieldset>
                {hands[handIdx] && ptsEdited && !manual && (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setPts(hands[handIdx].pts);
                      setPtsEdited(false);
                    }}
                  >
                    Reset points
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <form action={submit} className="card p-5">
        <h2 className="font-sans text-base font-semibold">2. Design details</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="field"><span className="label">Name</span><input name="name" required className="input" /></label>
          <label className="field"><span className="label">Slug (URL)</span><input name="slug" required pattern="[a-z0-9\-]{3,60}" className="input" placeholder="e.g. peacock-bridal" /></label>
          <label className="field"><span className="label">Category</span>
            <select name="category_slug" required defaultValue="" className="input">
              <option value="" disabled>Choose</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Complexity</span>
            <select name="complexity" defaultValue="moderate" className="input">
              <option value="simple">Simple</option><option value="moderate">Detailed</option><option value="intricate">Intricate</option><option value="bridal">Bridal</option>
            </select>
          </label>
          <label className="field"><span className="label">Starting price (₹, one hand)</span><input name="price" type="number" min={0} required className="input" /></label>
          <label className="field"><span className="label">Application time (minutes)</span><input name="duration_minutes" type="number" min={10} max={600} defaultValue={45} required className="input" /></label>
          <label className="field md:col-span-2"><span className="label">Description</span><textarea name="description" maxLength={600} className="input min-h-20" /></label>
          <label className="field"><span className="label">Publish</span>
            <select name="status" defaultValue="draft" className="input"><option value="draft">Save as draft (review first)</option><option value="active">Make live now</option></select>
          </label>
          <div className="space-y-2 self-end text-sm">
            <label className="flex items-start gap-2"><input type="checkbox" name="rights" required className="mt-1" /> I own this photo or have the artist’s permission to use it.</label>
            <label className="flex items-start gap-2"><input type="checkbox" name="consent_training" className="mt-1" /> The owner also agrees VAISHORA may use this photo to improve its design detection (optional).</label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn btn-primary btn-sm" disabled={!result || pending || !source}>{pending ? "Saving…" : "Create design"}</button>
          {state?.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
          {state?.ok && <p className="text-sm text-success" role="status">{state.ok}</p>}
        </div>
      </form>
    </div>
  );
}

function tintMask(mask: ImageData) {
  const out = new ImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i += 4) {
    out.data[i] = 91;
    out.data[i + 1] = 31;
    out.data[i + 2] = 15;
    out.data[i + 3] = mask.data[i + 3];
  }
  return out;
}
