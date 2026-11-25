"use client";

// Automatic hand detection for the artist portal's 3D preview (same MediaPipe model and approach as
// the admin importer: try the photo upright, then rotated 180° for fingers-down mehndi photos).
import type { Pt } from "./warp";

const MP_VERSION = "1.2.3";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

type Landmarker = { detect: (c: HTMLCanvasElement) => { landmarks: { x: number; y: number }[][]; handedness: { score: number }[][] }; close: () => void };
let landmarker: Promise<Landmarker> | null = null;

function load(): Promise<Landmarker> {
  if (!landmarker) {
    landmarker = (async () => {
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM);
      return (await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL },
        numHands: 2,
        runningMode: "IMAGE",
        minHandDetectionConfidence: 0.2,
        minHandPresenceConfidence: 0.2,
      })) as unknown as Landmarker;
    })().catch((e) => {
      landmarker = null;
      throw e;
    });
  }
  return landmarker;
}

/** Rotates/flattens a source onto an opaque white canvas of at most `max` px (transparent PNG/WebP → white). */
function prepared(src: HTMLCanvasElement, max: number, quarterTurns: number) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const w = Math.round(src.width * k);
  const h = Math.round(src.height * k);
  const odd = quarterTurns % 2 === 1;
  const c = document.createElement("canvas");
  c.width = odd ? h : w;
  c.height = odd ? w : h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2);
  g.rotate((quarterTurns * Math.PI) / 2);
  g.drawImage(src, -w / 2, -h / 2, w, h);
  return { c, k, w, h };
}

/** Maps a normalised landmark in a rotated detection canvas back to the original canvas's pixels. */
function back(x: number, y: number, turns: number, w: number, h: number, k: number): Pt {
  // un-rotate in the scaled space, then undo the scale
  const [ux, uy] = turns === 0 ? [x * w, y * h] : turns === 1 ? [y * w, (1 - x) * h] : turns === 2 ? [(1 - x) * w, (1 - y) * h] : [(1 - y) * w, x * h];
  return [ux / k, uy / k];
}

/**
 * 21 landmarks of the most confident hand, in the canvas's pixel space, or null when none is found.
 * Tries the photo upright, upside down (fingers-down mehndi photos) and sideways, at a detector-friendly size.
 */
export async function detectHand(canvas: HTMLCanvasElement): Promise<Pt[] | null> {
  const hl = await load();
  for (const max of [1024, 640]) {
    for (const turns of [0, 2, 1, 3]) {
      const { c, k, w, h } = prepared(canvas, max, turns);
      const res = hl.detect(c);
      if (!res.landmarks.length) continue;
      let best = 0;
      res.handedness.forEach((hd, i) => (hd[0]?.score ?? 0) > (res.handedness[best]?.[0]?.score ?? 0) && (best = i));
      return res.landmarks[best].map((p) => back(p.x, p.y, turns, w, h, k));
    }
  }
  return null;
}
