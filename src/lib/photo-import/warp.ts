// Turns a photo of a hand with mehndi into design assets for the 3D hand:
//  1. map the 21 MediaPipe hand landmarks onto the matching joints of our hand
//     (src/lib/mehndi/hand-landmarks.json, palm or back projection frame)
//  2. thin-plate-spline warp of the photo into that frame (inverse mapping, bilinear sampling)
//  3. extract the henna as a mask (pixels darker and redder than the person's own skin)
// Runs in the browser (admin), so it works on any host without a Python server.

import landmarks from "@/lib/mehndi/hand-landmarks.json";

export type Pt = [number, number];
export type Side = "palm" | "back";

/** MediaPipe Hands landmark index → our joint name. */
export const MP_TO_JOINT: string[] = [
  "wrist",
  "thumb-metacarpal",
  "thumb-phalanx-proximal",
  "thumb-phalanx-distal",
  "thumb-tip",
  ...["index", "middle", "ring", "pinky"].flatMap((f) => [
    `${f}-finger-phalanx-proximal`,
    `${f}-finger-phalanx-intermediate`,
    `${f}-finger-phalanx-distal`,
    `${f}-finger-tip`,
  ]),
];

const FRAME = 1000;

/** Target joint positions (0..1000 frame) for the 21 landmarks on the chosen side. */
export function targetPoints(side: Side): Pt[] {
  const j = (landmarks as unknown as Record<Side, Record<string, Pt>>)[side];
  return MP_TO_JOINT.map((n) => j[n]);
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** Chirality of a landmark set: sign of (index knuckle − wrist) × (pinky knuckle − wrist). */
export const chirality = (p: Pt[]) => Math.sign(cross(p[0], p[5], p[17]));

/** Adds stabilising control points: wrist sides and points just beyond each fingertip. */
function augment(p: Pt[]): Pt[] {
  const out = [...p];
  const w = p[0];
  const mid = p[9];
  const ax: Pt = [mid[0] - w[0], mid[1] - w[1]];
  const len = Math.hypot(ax[0], ax[1]) || 1;
  const n: Pt = [-ax[1] / len, ax[0] / len];
  const half = Math.hypot(p[5][0] - p[17][0], p[5][1] - p[17][1]) * 0.55;
  out.push([w[0] + n[0] * half, w[1] + n[1] * half], [w[0] - n[0] * half, w[1] - n[1] * half]);
  out.push([w[0] - (ax[0] / len) * half * 0.6, w[1] - (ax[1] / len) * half * 0.6]); // down the forearm
  for (const [dist, tip] of [[3, 4], [7, 8], [11, 12], [15, 16], [19, 20]]) {
    const d: Pt = [p[tip][0] - p[dist][0], p[tip][1] - p[dist][1]];
    out.push([p[tip][0] + d[0] * 0.45, p[tip][1] + d[1] * 0.45]);
  }
  return out;
}

const U = (r2: number) => (r2 < 1e-12 ? 0 : r2 * Math.log(r2) * 0.5);

/** Fits a 2D thin-plate spline f(from) = to. Returns an evaluator. */
export function fitTps(from: Pt[], to: Pt[]) {
  const n = from.length;
  const m = n + 3;
  const A: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = from[i][0] - from[j][0];
      const dy = from[i][1] - from[j][1];
      A[i][j] = U(dx * dx + dy * dy);
    }
    A[i][i] += 1e-3; // light regularisation
    A[i][n] = A[n][i] = 1;
    A[i][n + 1] = A[n + 1][i] = from[i][0];
    A[i][n + 2] = A[n + 2][i] = from[i][1];
  }
  const solve = (rhs: number[]) => {
    const M = A.map((r, i) => [...r, rhs[i]]);
    for (let c = 0; c < m; c++) {
      let piv = c;
      for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c] || 1e-12;
      for (let k = c; k <= m; k++) M[c][k] /= d;
      for (let r = 0; r < m; r++) {
        if (r === c) continue;
        const f = M[r][c];
        if (f) for (let k = c; k <= m; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r) => r[m]);
  };
  const wx = solve([...to.map((p) => p[0]), 0, 0, 0]);
  const wy = solve([...to.map((p) => p[1]), 0, 0, 0]);
  return (x: number, y: number): Pt => {
    let sx = wx[n] + wx[n + 1] * x + wx[n + 2] * y;
    let sy = wy[n] + wy[n + 1] * x + wy[n + 2] * y;
    for (let i = 0; i < n; i++) {
      const dx = x - from[i][0];
      const dy = y - from[i][1];
      const u = U(dx * dx + dy * dy);
      sx += wx[i] * u;
      sy += wy[i] * u;
    }
    return [sx, sy];
  };
}

export interface WarpResult {
  /** Real photo of the hand in our frame; alpha = hand coverage. */
  photo: ImageData;
  /** Henna mask (white, alpha = henna strength), with the brush edits applied. */
  mask: ImageData;
  size: number;
  /** Maps a frame pixel to the matching pixel of the ORIGINAL (unflipped) photo. */
  toSource: (x: number, y: number) => Pt;
}

/** Version of the projection frame in hand-landmarks.json (bumped whenever the hand mesh changes). */
export const FRAME_VERSION: number = (landmarks as unknown as { frameVersion?: number }).frameVersion ?? 1;

/**
 * Brush edits live in PHOTO space (same size as the original photo) so they survive a new hand mesh:
 * R = add henna, G = erase henna (0..255), anything else untouched.
 */
export function emptyEdits(w: number, h: number) {
  return new ImageData(w, h);
}

/** Paints a soft round dab into the photo-space edit layer. */
export function paintEdit(edits: ImageData, cx: number, cy: number, r: number, mode: "add" | "erase") {
  const { width: w, height: h, data } = edits;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  const on = mode === "add" ? 0 : 1;
  const off = 1 - on;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      const a = Math.round(255 * Math.min(1, (1 - d) * 3)); // soft 1/3 edge
      const o = (y * w + x) << 2;
      if (a > data[o + on]) data[o + on] = a;
      data[o + off] = Math.min(data[o + off], 255 - a);
      data[o + 3] = 255;
    }
}

/**
 * Warps `src` (photo pixels) so its landmarks `srcPts` (pixels) land on our hand's joints. `coverage` is our hand
 * silhouette in the same frame (alpha channel used); `edits` is the photo-space brush layer.
 */
export function warpPhoto(src: ImageData, srcPts: Pt[], side: Side, size: number, coverage: ImageData, edits: ImageData | null = null): WarpedPhoto {
  let pts = srcPts;
  let image = src;
  let flipped = false;
  const dstPts = targetPoints(side).map(([x, y]) => [(x / FRAME) * size, (y / FRAME) * size] as Pt);
  // A left hand (or mirrored photo) has the opposite chirality: flip it horizontally.
  if (chirality(pts) !== chirality(dstPts)) {
    image = flipX(src);
    pts = pts.map(([x, y]) => [src.width - 1 - x, y] as Pt);
    flipped = true;
  }
  const inv = fitTps(augment(dstPts), augment(pts)); // destination pixel → source pixel
  const photo = new ImageData(size, size);
  const { width: W, height: H, data: S } = image;
  const out = photo.data;
  // Coarse grid of TPS evaluations, bilinearly interpolated (fast and visually identical).
  const G = 8;
  const gw = Math.ceil(size / G) + 1;
  const grid = new Float32Array(gw * gw * 2);
  for (let gy = 0; gy < gw; gy++)
    for (let gx = 0; gx < gw; gx++) {
      const [sx, sy] = inv(gx * G, gy * G);
      grid[(gy * gw + gx) * 2] = sx;
      grid[(gy * gw + gx) * 2 + 1] = sy;
    }
  const cov = coverage.data;
  const cs = coverage.width;
  // brush edits sampled through the same mapping (edit layer is in original-photo space)
  const E = edits && edits.width === src.width && edits.height === src.height ? edits.data : null;
  const add = E ? new Uint8Array(size * size) : null;
  const erase = E ? new Uint8Array(size * size) : null;
  for (let y = 0; y < size; y++) {
    const gy = Math.min(gw - 2, Math.floor(y / G));
    const fy = y / G - gy;
    for (let x = 0; x < size; x++) {
      const ca = cov[((Math.floor((y * cs) / size) * cs + Math.floor((x * cs) / size)) << 2) + 3];
      if (ca < 8) continue;
      const gx = Math.min(gw - 2, Math.floor(x / G));
      const fx = x / G - gx;
      const i00 = (gy * gw + gx) * 2;
      const i10 = i00 + 2;
      const i01 = i00 + gw * 2;
      const i11 = i01 + 2;
      const sx = (grid[i00] * (1 - fx) + grid[i10] * fx) * (1 - fy) + (grid[i01] * (1 - fx) + grid[i11] * fx) * fy;
      const sy = (grid[i00 + 1] * (1 - fx) + grid[i10 + 1] * fx) * (1 - fy) + (grid[i01 + 1] * (1 - fx) + grid[i11 + 1] * fx) * fy;
      if (sx < 0 || sy < 0 || sx >= W - 1 || sy >= H - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const ax = sx - x0;
      const ay = sy - y0;
      const o = (y * size + x) << 2;
      for (let c = 0; c < 3; c++) {
        const p00 = S[((y0 * W + x0) << 2) + c];
        const p10 = S[((y0 * W + x0 + 1) << 2) + c];
        const p01 = S[(((y0 + 1) * W + x0) << 2) + c];
        const p11 = S[(((y0 + 1) * W + x0 + 1) << 2) + c];
        out[o + c] = (p00 * (1 - ax) + p10 * ax) * (1 - ay) + (p01 * (1 - ax) + p11 * ax) * ay;
      }
      out[o + 3] = ca;
      if (E && add && erase) {
        const ex = Math.round(flipped ? W - 1 - sx : sx);
        const e = ((Math.round(sy) * W + ex) << 2);
        add[y * size + x] = E[e];
        erase[y * size + x] = E[e + 1];
      }
    }
  }
  const toSource = (x: number, y: number): Pt => {
    const [sx, sy] = inv(x, y);
    return [flipped ? W - 1 - sx : sx, sy];
  };
  return { photo, size, toSource, add, erase };
}

/** The photo warped into the hand frame, before henna extraction (lets any extractor run on it). */
export interface WarpedPhoto {
  photo: ImageData;
  size: number;
  toSource: (x: number, y: number) => Pt;
  /** Brush edits sampled into the frame (null when there are none). */
  add: Uint8Array | null;
  erase: Uint8Array | null;
}

/** Applies the brush edits to a henna mask in the frame (mutates and returns `mask`). */
export function applyEdits(mask: ImageData, w: WarpedPhoto): ImageData {
  if (!w.add || !w.erase) return mask;
  const m = mask.data;
  const out = w.photo.data;
  for (let i = 0; i < w.size * w.size; i++) {
    if (!w.add[i] && !w.erase[i]) continue;
    const o = i << 2;
    const a = Math.max(m[o + 3], w.add[i]) * (1 - w.erase[i] / 255);
    m[o] = m[o + 1] = m[o + 2] = 255;
    m[o + 3] = Math.round(a * (out[o + 3] / 255));
  }
  return mask;
}

/**
 * Warps `src` (photo pixels) so its landmarks `srcPts` (pixels) land on our hand's joints and extracts the henna
 * with the rule-based extractor. `coverage` is our hand silhouette in the same frame (alpha), `sensitivity` 0..1.
 */
export function warpToHand(src: ImageData, srcPts: Pt[], side: Side, size: number, coverage: ImageData, sensitivity = 0.5, edits: ImageData | null = null): WarpResult {
  const w = warpPhoto(src, srcPts, side, size, coverage, edits);
  return { photo: w.photo, mask: applyEdits(extractHenna(w.photo, sensitivity), w), size, toSource: w.toSource };
}

function flipX(img: ImageData) {
  const out = new ImageData(img.width, img.height);
  const w = img.width;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < w; x++) {
      const a = (y * w + x) << 2;
      const b = (y * w + (w - 1 - x)) << 2;
      out.data[b] = img.data[a];
      out.data[b + 1] = img.data[a + 1];
      out.data[b + 2] = img.data[a + 2];
      out.data[b + 3] = img.data[a + 3];
    }
  return out;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Henna = noticeably darker than the person's own skin and warm (red/brown, not grey shadow).
 * Skin reference is the brighter half of the covered pixels, so it adapts to any skin tone.
 */
/** Mean of `v` over covered pixels in a (2r+1)² box, via integral images (ignores uncovered pixels). */
function localMean(v: Float32Array, cov: Uint8Array, w: number, h: number, r: number) {
  const S = new Float64Array((w + 1) * (h + 1));
  const C = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0;
    let rc = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cov[i]) {
        rs += v[i];
        rc += 1;
      }
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + rs;
      C[(y + 1) * (w + 1) + x + 1] = C[y * (w + 1) + x + 1] + rc;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const a = y1 * (w + 1);
      const b = y0 * (w + 1);
      const sum = S[a + x1] - S[a + x0] - S[b + x1] + S[b + x0];
      const cnt = C[a + x1] - C[a + x0] - C[b + x1] + C[b + x0];
      out[y * w + x] = cnt ? sum / cnt : 0;
    }
  }
  return out;
}

/**
 * Henna = darker AND redder than the skin immediately around it. Comparing with the local skin
 * (not one global colour) cancels lighting and shading, so creases and shadows are not mistaken
 * for henna, and it adapts to any skin tone. `sensitivity` 0..1.
 */
export function extractHenna(photo: ImageData, sensitivity = 0.5): ImageData {
  const { width: w, height: h, data: d } = photo;
  const n = w * h;
  const L = new Float32Array(n);
  const RG = new Float32Array(n);
  const cov = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (d[i * 4 + 3] < 128) continue;
    cov[i] = 1;
    const r = d[i * 4];
    L[i] = 0.299 * r + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    RG[i] = (r - d[i * 4 + 1]) / (r + 1);
  }
  // Two passes: a first estimate, then re-estimate local skin excluding likely henna pixels.
  const rad = Math.max(8, Math.round(w / 48));
  let skinL = localMean(L, cov, w, h, rad);
  let skinRG = localMean(RG, cov, w, h, rad);
  const skinOnly = new Uint8Array(n);
  for (let i = 0; i < n; i++) skinOnly[i] = cov[i] && L[i] > skinL[i] * 0.9 ? 1 : 0;
  skinL = localMean(L, skinOnly, w, h, rad);
  skinRG = localMean(RG, skinOnly, w, h, rad);

  const darkNeed = 0.3 - 0.18 * sensitivity; // fraction darker than local skin
  const redNeed = 0.09 - 0.05 * sensitivity; // extra red relative to local skin
  const mask = new ImageData(w, h);
  const m = mask.data;
  for (let i = 0; i < n; i++) {
    if (!cov[i] || skinL[i] <= 0) continue;
    const dl = (skinL[i] - L[i]) / skinL[i];
    const dr = RG[i] - skinRG[i];
    const dark = smooth(darkNeed * 0.7, darkNeed * 1.4, dl);
    const red = smooth(redNeed * 0.5, redNeed * 1.5, dr);
    const paste = smooth(0.5, 0.65, dl); // very dark fresh paste may be near-neutral brown
    const a = dark * Math.max(red, paste);
    m[i * 4] = m[i * 4 + 1] = m[i * 4 + 2] = 255;
    m[i * 4 + 3] = Math.round(a * (d[i * 4 + 3] / 255) * 255);
  }
  return mask;
}
