"use client";

// Learned henna extraction (docs/HAND_AI_ARCHITECTURE.md §5.1 stage 3): a small U-Net trained by
// scripts/ml/train.py, run in the browser with ONNX Runtime Web (MIT). Admin-only and loaded on demand; any
// failure falls back to the rule-based extractor. The runtime is pinned and loaded from jsDelivr like MediaPipe.

const ORT_VERSION = "1.27.0";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MANIFEST = "/models/ml/henna.json";
const LIVE = "/api/ml/henna-model";

export interface HennaModelInfo {
  version: number;
  method: string; // e.g. "unet-v0"
  url: string;
  workingSize: number;
  threshold: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ort = any;
declare global {
  interface Window {
    ort?: Ort;
  }
}

let ortLoading: Promise<Ort> | null = null;
function loadOrt(): Promise<Ort> {
  if (window.ort) return Promise.resolve(window.ort);
  if (ortLoading) return ortLoading;
  ortLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${ORT_BASE}ort.min.js`;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onload = () => {
      const ort = window.ort;
      if (!ort) return reject(new Error("ONNX Runtime did not load"));
      ort.env.wasm.wasmPaths = ORT_BASE;
      ort.env.wasm.numThreads = 1; // no cross-origin isolation on this site, so no wasm threads
      resolve(ort);
    };
    s.onerror = () => {
      ortLoading = null;
      reject(new Error("Could not load ONNX Runtime"));
    };
    document.head.appendChild(s);
  });
  return ortLoading;
}

let sessionPromise: Promise<{ ort: Ort; session: any; info: HennaModelInfo } | null> | null = null;

/** Loads the current henna model, or resolves null when none is published / it cannot run here. */
export function loadHennaModel() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      try {
        // the live version from the model registry (it changes as the detector retrains itself); the bundled
        // manifest is the fallback when the registry is unreachable
        let res = await fetch(LIVE, { cache: "no-store" }).catch(() => null);
        if (!res?.ok) res = await fetch(MANIFEST, { cache: "no-cache" });
        if (!res.ok) return null;
        const info = (await res.json()) as HennaModelInfo;
        const ort = await loadOrt();
        const session = await ort.InferenceSession.create(info.url, { executionProviders: ["wasm"] });
        return { ort, session, info };
      } catch (e) {
        console.warn("Henna model unavailable, using the rule-based extractor", e);
        return null;
      }
    })();
  }
  return sessionPromise;
}

export interface ModelMask {
  mask: ImageData;
  /** 0..100: share of hand pixels the model is unsure about (higher = review first). */
  uncertainty: number;
  method: string;
}

/**
 * Runs the model on a photo already warped into the hand frame (alpha = hand coverage).
 * Returns a soft henna mask at the frame size, or null if the model is unavailable.
 */
export async function modelHenna(photo: ImageData): Promise<ModelMask | null> {
  const m = await loadHennaModel();
  if (!m) return null;
  const { ort, session, info } = m;
  const S = info.workingSize; // run at e.g. 1024 for a 2048 frame
  const src = document.createElement("canvas");
  src.width = photo.width;
  src.height = photo.height;
  src.getContext("2d")!.putImageData(photo, 0, 0);
  const small = document.createElement("canvas");
  small.width = S;
  small.height = S;
  const sg = small.getContext("2d", { willReadFrequently: true })!;
  sg.drawImage(src, 0, 0, S, S);
  const px = sg.getImageData(0, 0, S, S).data;
  const input = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) {
    const a = px[i * 4 + 3] / 255;
    if (a < 0.5) continue; // outside the hand stays 0, as in training
    input[i] = px[i * 4] / 255;
    input[S * S + i] = px[i * 4 + 1] / 255;
    input[2 * S * S + i] = px[i * 4 + 2] / 255;
  }
  const out = await session.run({ image: new ort.Tensor("float32", input, [1, 3, S, S]) });
  const prob = out.henna.data as Float32Array;
  // probability → alpha at working size, then smooth upscale to the frame size
  const lo = new ImageData(S, S);
  let unsure = 0;
  let covered = 0;
  for (let i = 0; i < S * S; i++) {
    const cov = px[i * 4 + 3] / 255;
    if (cov < 0.5) continue;
    const p = prob[i];
    covered++;
    if (p > 0.2 && p < 0.8) unsure++;
    const t = Math.min(1, Math.max(0, (p - (info.threshold - 0.15)) / 0.3)); // soft edge centred on the threshold
    lo.data[i * 4] = lo.data[i * 4 + 1] = lo.data[i * 4 + 2] = 255;
    lo.data[i * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  const loC = document.createElement("canvas");
  loC.width = S;
  loC.height = S;
  loC.getContext("2d")!.putImageData(lo, 0, 0);
  const full = document.createElement("canvas");
  full.width = photo.width;
  full.height = photo.height;
  const fg = full.getContext("2d", { willReadFrequently: true })!;
  fg.imageSmoothingQuality = "high";
  fg.drawImage(loC, 0, 0, photo.width, photo.height);
  const mask = fg.getImageData(0, 0, photo.width, photo.height);
  // keep the hand silhouette exact
  for (let i = 3; i < mask.data.length; i += 4) mask.data[i] = Math.round((mask.data[i] * photo.data[i]) / 255);
  return { mask, uncertainty: covered ? Math.round((1000 * unsure) / covered) / 10 : 0, method: info.method };
}
