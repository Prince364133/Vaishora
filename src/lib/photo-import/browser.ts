"use client";

// Browser helpers shared by the photo importer and the re-projection tool.
import { applyEdits, extractHenna, Pt, Side, targetPoints, warpPhoto, WarpResult } from "./warp";
import { modelHenna } from "./henna-model";

/** Long edge of the stored original photo (keeps uploads under the 6 MB limit while staying sharp). */
export const SOURCE_MAX = 3072;
/** Size of the warped design assets (square, in the hand's projection frame). */
export const OUT = 2048;

export function loadImageUrl(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  return img.decode().then(() => img);
}

/** Draws an image into a canvas no larger than SOURCE_MAX on its long edge. */
export function normaliseSource(img: HTMLImageElement): HTMLCanvasElement {
  const k = Math.min(1, SOURCE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export function imageData(img: CanvasImageSource, w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

export function canvasBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode image"))), type, quality));
}

export function dataBlob(d: ImageData, type = "image/webp", quality = 0.92): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = d.width;
  c.height = d.height;
  c.getContext("2d")!.putImageData(d, 0, 0);
  return canvasBlob(c, type, quality);
}

const coverageCache = new Map<Side, Promise<ImageData>>();
/** Our hand's silhouette in the projection frame (alpha), from /hand/<side>.webp. */
export function coverage(side: Side): Promise<ImageData> {
  let p = coverageCache.get(side);
  if (!p) {
    p = loadImageUrl(`/hand/${side}.webp`).then((img) => imageData(img, 512, 512));
    coverageCache.set(side, p);
  }
  return p;
}

export type Extractor = "model" | "rules";

export interface SourceResult extends WarpResult {
  /** Method that produced the mask: "unet-v<N>" or "heuristic-v1". */
  method: string;
  /** Model uncertainty 0..100 (null for the rule-based extractor). */
  uncertainty: number | null;
}

/**
 * Warps a source photo into the hand frame and extracts the henna with the learned model (falling back to the
 * rule-based extractor when the model is unavailable or `extractor` is "rules"), then applies brush edits.
 */
// The model's mask depends only on the photo, the points and the side, so brush strokes and slider moves reuse it.
let modelCache: { src: ImageData; key: string; m: Awaited<ReturnType<typeof modelHenna>> } | null = null;

export async function warpSource(src: ImageData, pts: Pt[], side: Side, sensitivity: number, edits: ImageData | null, extractor: Extractor = "rules"): Promise<SourceResult> {
  const w = warpPhoto(src, pts, side, OUT, await coverage(side), edits);
  let m: Awaited<ReturnType<typeof modelHenna>> = null;
  if (extractor === "model") {
    const key = `${side}|${pts.map((p) => p.join(",")).join(";")}`;
    if (modelCache && modelCache.src === src && modelCache.key === key) m = modelCache.m;
    else {
      m = await modelHenna(w.photo);
      modelCache = { src, key, m };
    }
  }
  // copy: applyEdits mutates the mask and the cached one must stay clean
  const mask = m ? new ImageData(new Uint8ClampedArray(m.mask.data), m.mask.width, m.mask.height) : extractHenna(w.photo, sensitivity);
  return { photo: w.photo, mask: applyEdits(mask, w), size: OUT, toSource: w.toSource, method: m ? m.method : "heuristic-v1", uncertainty: m ? m.uncertainty : null };
}

/** Starting points for manual placement: our hand's joints, centred in the photo. */
export function templatePoints(side: Side, w: number, h: number): Pt[] {
  const k = (0.85 * Math.min(w, h)) / 1000;
  return targetPoints(side).map(([x, y]) => [w / 2 + (x - 500) * k, h / 2 + (y - 500) * k] as Pt);
}
