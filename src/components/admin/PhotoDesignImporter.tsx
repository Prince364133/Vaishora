"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createDesignFromPhotoAction, type ActionState } from "@/app/admin/actions";
import { Pt, Side, warpToHand } from "@/lib/photo-import/warp";

const MP_VERSION = "1.2.3";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const OUT = 2048;

type Detected = { pts: Pt[]; label: string; score: number };

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function imageData(img: CanvasImageSource, w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

function toBlob(d: ImageData): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = d.width;
  c.height = d.height;
  c.getContext("2d")!.putImageData(d, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode image"))), "image/webp", 0.92));
}

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

/**
 * Admin: turn a photo of a hand with mehndi into a new design. MediaPipe Hands (in the browser)
 * finds 21 landmarks, the photo is warped onto our 3D hand's palm or back frame, and the henna is
 * extracted as a mask. Both are uploaded as the design's assets.
 */
export function PhotoDesignImporter({ categories }: { categories: { slug: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createDesignFromPhotoAction, null);
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [hands, setHands] = useState<Detected[]>([]);
  const [handIdx, setHandIdx] = useState(0);
  const [side, setSide] = useState<Side>("palm");
  const [sensitivity, setSensitivity] = useState(0.5);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<{ photo: ImageData; mask: ImageData } | null>(null);
  const srcCanvas = useRef<HTMLCanvasElement>(null);
  const photoCanvas = useRef<HTMLCanvasElement>(null);
  const maskCanvas = useRef<HTMLCanvasElement>(null);
  const form = useRef<HTMLFormElement>(null);

  // 1. detect hands when a photo is chosen
  async function onFile(f: File | null) {
    setFile(f);
    setHands([]);
    setResult(null);
    if (!f) return;
    try {
      setStatus("Loading hand detection…");
      const image = await loadImage(f);
      setImg(image);
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
      const W = image.naturalWidth;
      const H = image.naturalHeight;
      // Fingers-down photos (common for mehndi) detect better upright: try as-is, then rotated 180°.
      const attempts: Array<{ src: CanvasImageSource; rot: boolean }> = [{ src: image, rot: false }];
      const rc = document.createElement("canvas");
      rc.width = W;
      rc.height = H;
      const rg = rc.getContext("2d")!;
      rg.translate(W, H);
      rg.rotate(Math.PI);
      rg.drawImage(image, 0, 0);
      attempts.push({ src: rc, rot: true });
      let found: Detected[] = [];
      for (const a of attempts) {
        const res = hl.detect(a.src as HTMLCanvasElement);
        found = res.landmarks.map((lm, i) => ({
          pts: lm.map((p) => (a.rot ? [W - p.x * W, H - p.y * H] : [p.x * W, p.y * H]) as Pt),
          label: res.handedness[i]?.[0]?.categoryName ?? "",
          score: res.handedness[i]?.[0]?.score ?? 0,
        }));
        if (found.length) break;
      }
      hl.close();
      if (!found.length) {
        setStatus("No hand found. Use a clear, well-lit photo with the whole hand and fingers visible.");
        return;
      }
      setHands(found);
      setHandIdx(0);
      setStatus(`Found ${found.length} hand${found.length > 1 ? "s" : ""}. Check the preview, then save.`);
    } catch (e) {
      setStatus(`Hand detection failed: ${e instanceof Error ? e.message : typeof e === "string" ? e : "could not load the detector (check the internet connection)"}`);
    }
  }

  // 2. warp + extract whenever the inputs change
  useEffect(() => {
    if (!img || !hands[handIdx]) return;
    let cancelled = false;
    (async () => {
      const cov = new Image();
      cov.src = `/hand/${side}.webp`;
      await cov.decode();
      if (cancelled) return;
      const coverage = imageData(cov, 512, 512);
      const src = imageData(img, img.naturalWidth, img.naturalHeight);
      const r = warpToHand(src, hands[handIdx].pts, side, OUT, coverage, sensitivity);
      if (!cancelled) setResult({ photo: r.photo, mask: r.mask });
    })().catch((e) => setStatus(`Could not process the photo: ${(e as Error).message}`));
    return () => {
      cancelled = true;
    };
  }, [img, hands, handIdx, side, sensitivity]);

  // previews
  useEffect(() => {
    if (!img || !srcCanvas.current) return;
    const c = srcCanvas.current;
    const scale = Math.min(1, 900 / img.naturalWidth);
    c.width = img.naturalWidth * scale;
    c.height = img.naturalHeight * scale;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, c.width, c.height);
    hands.forEach((h, i) => {
      g.fillStyle = i === handIdx ? "#d4af7c" : "rgba(255,255,255,.6)";
      h.pts.forEach(([x, y]) => {
        g.beginPath();
        g.arc(x * scale, y * scale, i === handIdx ? 5 : 3, 0, Math.PI * 2);
        g.fill();
      });
    });
  }, [img, hands, handIdx]);
  useEffect(() => {
    draw(photoCanvas.current, result?.photo ?? null, "#4b1d3f");
    draw(maskCanvas.current, result ? tintMask(result.mask) : null, "#f2d3c4");
  }, [result]);

  async function submit(fd: FormData) {
    if (!result) return;
    fd.set(`art_${side}`, new File([await toBlob(result.mask)], `${side}-mask.webp`, { type: "image/webp" }));
    fd.set(`photo_${side}`, new File([await toBlob(result.photo)], `${side}-photo.webp`, { type: "image/webp" }));
    fd.set("region", side);
    action(fd);
  }

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
        {img && (
          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <figure>
              <canvas ref={srcCanvas} className="w-full rounded-[var(--radius-sm)] bg-blush" />
              <figcaption className="mt-1 text-xs text-muted">Detected hand points</figcaption>
            </figure>
            <figure>
              <canvas ref={photoCanvas} className="aspect-square w-full rounded-[var(--radius-sm)]" />
              <figcaption className="mt-1 text-xs text-muted">Photo fitted to our 3D hand ({side})</figcaption>
            </figure>
            <figure>
              <canvas ref={maskCanvas} className="aspect-square w-full rounded-[var(--radius-sm)]" />
              <figcaption className="mt-1 text-xs text-muted">Extracted henna</figcaption>
            </figure>
          </div>
        )}
        {hands.length > 0 && (
          <div className="mt-4 flex flex-wrap items-end gap-4">
            {hands.length > 1 && (
              <label className="field">
                <span className="label">Hand</span>
                <select className="input w-auto" value={handIdx} onChange={(e) => setHandIdx(Number(e.target.value))}>
                  {hands.map((h, i) => (
                    <option key={i} value={i}>Hand {i + 1}{h.label ? ` (${h.label.toLowerCase()})` : ""}</option>
                  ))}
                </select>
              </label>
            )}
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
            <label className="field min-w-56">
              <span className="label">Henna detection sensitivity</span>
              <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} />
            </label>
          </div>
        )}
      </section>

      <form ref={form} action={submit} className="card p-5">
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
          <label className="flex items-start gap-2 self-end text-sm"><input type="checkbox" name="rights" required className="mt-1" /> I own this photo or have the artist’s permission to use it.</label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn btn-primary btn-sm" disabled={!result || pending || !file}>{pending ? "Saving…" : "Create design"}</button>
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

