"use client";

import { useEffect, useRef, useState } from "react";
import { LazyHandViewer3D } from "@/components/hand/LazyHandViewer3D";
import { youTubeId } from "@/lib/youtube";

type Side = "palm" | "back";
type Assets = { palm?: string; back?: string; palm_photo?: string; back_photo?: string };

/**
 * The media part of the artist's design form, with a Photos / 3D switch. Both panels stay mounted (the
 * form submits every input); only the visible one changes.
 *  - Photos: existing photos (server-rendered slot), new photo picker, optional YouTube video.
 *  - 3D: pick the clearest photo of one hand → the hand is detected in the browser, the photo is fitted
 *    to our 3D hand and the henna extracted → instant 3D preview. The results are attached to the form.
 */
export function DesignMediaFields({ photos, existingAssets, region, videoUrl }: { photos: React.ReactNode; existingAssets: Assets; region: "palm" | "back" | "palm_back" | "feet"; videoUrl?: string | null }) {
  const [tab, setTab] = useState<"photos" | "3d">("photos");
  const [video, setVideo] = useState(videoUrl ?? "");
  const vid = youTubeId(video);
  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl">Photos, video and 3D</h2>
        <div className="inline-flex rounded-full bg-blush p-0.5 text-sm font-semibold" role="tablist" aria-label="Design media">
          {(
            [
              ["photos", "Photos & video"],
              ["3d", "3D preview"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-10 rounded-full px-4 ${tab === k ? "bg-plum text-ivory" : "text-plum"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className={tab === "photos" ? "mt-4 space-y-4" : "hidden"} role="tabpanel">
        {photos}
        <div className="field">
          <label htmlFor="video_url">
            YouTube video <span className="font-normal text-muted">(optional, one video)</span>
          </label>
          <input id="video_url" name="video_url" type="url" inputMode="url" className="input" maxLength={300} value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://youtube.com/shorts/…" autoCapitalize="none" spellCheck={false} />
          <p className={video && !vid ? "field-error" : "field-hint"}>
            {video && !vid ? "This doesn’t look like a YouTube link." : "Plays silently on loop at the start of your design’s gallery; customers can tap for sound."}
          </p>
          {vid && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`https://i.ytimg.com/vi/${vid}/mqdefault.jpg`} alt="Video thumbnail" className="mt-1 w-48 rounded-[var(--radius-sm)]" loading="lazy" />
          )}
        </div>
      </div>

      <div className={tab === "3d" ? "mt-4" : "hidden"} role="tabpanel">
        <ThreeDMaker existing={existingAssets} region={region} />
      </div>
    </section>
  );
}

function ThreeDMaker({ existing, region }: { existing: Assets; region: "palm" | "back" | "palm_back" | "feet" }) {
  const [side, setSide] = useState<Side>(region === "back" ? "back" : "palm");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ side: Side; art: string; photo: string } | null>(null);
  const [remove, setRemove] = useState(false);
  const [sensitivity, setSensitivity] = useState(0.5);
  type Source = { canvas: HTMLCanvasElement; data: ImageData; pts: [number, number][] };
  const [source, setSource] = useState<Source | null>(null);
  const [editing, setEditing] = useState<[number, number][] | null>(null);
  const artInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const hasExisting = !!(existing.palm || existing.back);

  useEffect(() => () => {
    if (preview) {
      URL.revokeObjectURL(preview.art);
      URL.revokeObjectURL(preview.photo);
    }
  }, [preview]);

  async function build(s: Side, sens: number, src: Source | null = source) {
    if (!src) return;
    setBusy(true);
    setStatus("Fitting your design onto the 3D hand…");
    try {
      const { warpSource, dataBlob } = await import("@/lib/photo-import/browser");
      const r = await warpSource(src.data, src.pts, s, sens, null);
      const [art, photo] = await Promise.all([dataBlob(r.mask), dataBlob(r.photo)]);
      const put = (input: HTMLInputElement | null, blob: Blob, name: string) => {
        if (!input) return;
        const dt = new DataTransfer();
        dt.items.add(new File([blob], name, { type: "image/webp" }));
        input.files = dt.files;
      };
      put(artInput.current, art, `${s}-mask.webp`);
      put(photoInput.current, photo, `${s}-photo.webp`);
      setPreview({ side: s, art: URL.createObjectURL(art), photo: URL.createObjectURL(photo) });
      setRemove(false);
      setStatus("Here’s your design in 3D. Drag to turn the hand. It will be saved with the design.");
    } catch (e) {
      setStatus(`Could not build the 3D preview: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(f: File | null) {
    setSource(null);
    setPreview(null);
    if (!f) return;
    setBusy(true);
    setStatus("Finding the hand in your photo…");
    try {
      const { normaliseSource, imageData } = await import("@/lib/photo-import/browser");
      const { detectHand } = await import("@/lib/photo-import/detect");
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = normaliseSource(img);
      URL.revokeObjectURL(url);
      const pts = await detectHand(canvas);
      const data = imageData(canvas, canvas.width, canvas.height);
      if (!pts) {
        // Dense henna can hide the hand from the detector: let the artist place the joints.
        const { templatePoints } = await import("@/lib/photo-import/browser");
        const start = templatePoints(side, canvas.width, canvas.height);
        setSource({ canvas, data, pts: start });
        setEditing(start);
        setStatus("We couldn’t find the hand automatically (common with very dense henna). Drag each dot onto the matching joint — wrist, then each finger from knuckle to tip — and tap “Build 3D”.");
        setBusy(false);
        return;
      }
      const src = { canvas, data, pts };
      setSource(src);
      setEditing(null);
      await build(side, sensitivity, src);
    } catch (e) {
      setStatus(`Hand detection failed: ${(e as Error).message}. Check your internet connection and try again.`);
      setBusy(false);
    }
  }

  const shown = preview
    ? { palm: preview.side === "palm" ? preview.art : undefined, back: preview.side === "back" ? preview.art : undefined, palm_photo: preview.side === "palm" ? preview.photo : undefined, back_photo: preview.side === "back" ? preview.photo : undefined }
    : remove
      ? null
      : hasExisting
        ? existing
        : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Choose the clearest photo of <strong>one hand</strong> with the whole {side === "palm" ? "palm" : "back of the hand"} and all fingers visible. We place your design on our 3D hand so customers can turn it around.</p>
      <fieldset>
        <legend className="text-sm font-semibold text-plum-ink">The photo shows the</legend>
        <div className="mt-2 flex gap-2">
          {(["palm", "back"] as const).map((s) => (
            <label key={s} className="chip cursor-pointer has-[:checked]:border-plum has-[:checked]:bg-plum has-[:checked]:text-ivory">
              <input
                type="radio"
                className="sr-only"
                checked={side === s}
                onChange={() => {
                  setSide(s);
                  if (source) void build(s, sensitivity);
                }}
              />
              {s === "palm" ? "Palm" : "Back of hand"}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border border-dashed border-rose-deep/40 bg-blush/40 px-4 py-3 text-center text-sm text-plum hover:bg-blush">
        <span className="font-semibold">{busy ? "Working…" : "Choose photo for 3D"}</span>
        <span className="text-xs text-muted">Processed on your phone — nothing is uploaded until you save.</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </label>
      {status && (
        <p className="text-sm" role="status">
          {status}
        </p>
      )}
      {editing && source && (
        <PointEditor
          canvas={source.canvas}
          pts={editing}
          onChange={setEditing}
          onDone={() => {
            const next = { ...source, pts: editing };
            setSource(next);
            setEditing(null);
            void build(side, sensitivity, next);
          }}
        />
      )}
      {preview && !editing && source && (
        <button type="button" className="link tap-link text-sm" onClick={() => setEditing(source.pts.map((x) => [...x] as [number, number]))}>
          Hand looks off? Adjust the hand points
        </button>
      )}
      {preview && (
        <label className="block text-sm">
          <span className="font-semibold text-plum-ink">Henna detection</span>
          <input
            type="range"
            min={0.2}
            max={0.8}
            step={0.05}
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
            onPointerUp={() => void build(side, sensitivity)}
            onKeyUp={() => void build(side, sensitivity)}
            className="mt-1 w-full accent-[var(--color-plum)]"
          />
          <span className="flex justify-between text-xs text-muted">
            <span>Only the darkest lines</span>
            <span>Lighter lines too</span>
          </span>
        </label>
      )}
      {shown && (
        <div className="arch relative h-[min(60svh,460px)] overflow-hidden bg-plum">
          <LazyHandViewer3D
            key={`${shown.palm ?? ""}${shown.back ?? ""}`}
            palmArt={shown.palm ?? null}
            backArt={shown.back ?? null}
            region={shown.palm && shown.back ? "palm_back" : shown.back ? "back" : "palm"}
            designName="Your design"
            palmPhoto={shown.palm_photo ?? null}
            backPhoto={shown.back_photo ?? null}
            customOnly
            className="absolute inset-0 pt-6"
          />
        </div>
      )}
      {hasExisting && !preview && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="remove_3d" value="1" checked={remove} onChange={(e) => setRemove(e.target.checked)} className="h-5 w-5 accent-[var(--color-danger)]" />
          Remove the 3D preview
        </label>
      )}
      <input ref={artInput} type="file" name={`art_${preview?.side ?? side}`} className="hidden" tabIndex={-1} aria-hidden />
      <input ref={photoInput} type="file" name={`photo_${preview?.side ?? side}`} className="hidden" tabIndex={-1} aria-hidden />
    </div>
  );
}

// MediaPipe landmark order: wrist, thumb (4), index (4), middle (4), ring (4), little (4).
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

/** Drag the 21 hand joints onto the photo (touch and mouse). */
function PointEditor({ canvas, pts, onChange, onDone }: { canvas: HTMLCanvasElement; pts: [number, number][]; onChange: (p: [number, number][]) => void; onDone: () => void }) {
  const view = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number | null>(null);
  const k = Math.min(1, 900 / canvas.width);

  useEffect(() => {
    const c = view.current;
    if (!c) return;
    c.width = Math.round(canvas.width * k);
    c.height = Math.round(canvas.height * k);
    const g = c.getContext("2d")!;
    g.drawImage(canvas, 0, 0, c.width, c.height);
    const u = c.width / Math.max(1, c.getBoundingClientRect().width || c.width);
    g.strokeStyle = "rgba(212,175,124,.9)";
    g.lineWidth = 2.5 * u;
    for (const [a, b] of BONES) {
      g.beginPath();
      g.moveTo(pts[a][0] * k, pts[a][1] * k);
      g.lineTo(pts[b][0] * k, pts[b][1] * k);
      g.stroke();
    }
    pts.forEach(([x, y], i) => {
      g.beginPath();
      g.arc(x * k, y * k, (i === 0 ? 9 : 7) * u, 0, Math.PI * 2);
      g.fillStyle = i === 0 ? "#4b1d3f" : "#d4af7c";
      g.fill();
      g.strokeStyle = "#fff";
      g.lineWidth = 2 * u;
      g.stroke();
    });
  }, [canvas, pts, k]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height];
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={view}
        className="w-full touch-none rounded-[var(--radius-sm)] bg-blush"
        aria-label="Hand points on your photo: drag each dot onto its joint"
        onPointerDown={(e) => {
          const [x, y] = at(e);
          const grab = (28 * canvas.width) / e.currentTarget.getBoundingClientRect().width;
          let best = -1;
          let bd = grab;
          pts.forEach(([px, py], i) => {
            const d = Math.hypot(px - x, py - y);
            if (d < bd) [bd, best] = [d, i];
          });
          if (best < 0) return;
          drag.current = best;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const [x, y] = at(e);
          const i = drag.current;
          onChange(pts.map((p, j) => (j === i ? [Math.max(0, Math.min(canvas.width - 1, x)), Math.max(0, Math.min(canvas.height - 1, y))] : p)));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <p className="text-xs text-muted">The dark dot is the wrist. Gold dots run from each finger’s base knuckle to its tip, thumb first.</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={onDone}>
        Build 3D
      </button>
    </div>
  );
}
