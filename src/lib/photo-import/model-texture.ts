"use client";

// Paints a design onto the "3D model" viewer's own hands. Input: the henna mask + fitted photo in our hand frame
// (what every photo import already produces). Output: a texture for the model's front (palms) or back, with the
// design on BOTH hands (mirrored for the other hand). The henna is transferred as a stain: its darkening and colour
// relative to the artist's own skin are applied to the model's skin, so it matches the model's skin tone.
// Model hand landmarks: scripts/model3d/hand_landmarks.py -> public/tryon/model/landmarks.json + hands-mask.png.
import { augment, chirality, fitTps, Pt, Side, targetPoints } from "./warp";
import { imageData, loadImageUrl } from "./browser";

type ModelSide = "front" | "back";
interface ModelLandmarks {
  front: { width: number; height: number; hands: { pts: Pt[] }[] };
  back: { width: number; height: number; hands: { pts: Pt[] }[] };
}

let landmarks: Promise<ModelLandmarks> | null = null;
const loadLandmarks = (): Promise<ModelLandmarks> => (landmarks ??= fetch("/tryon/model/landmarks.json").then((r) => r.json() as Promise<ModelLandmarks>));
let regions: Promise<ImageData> | null = null;
const loadRegions = () => (regions ??= loadImageUrl("/tryon/model/hands-mask.png").then((im) => imageData(im, im.naturalWidth, im.naturalHeight)));

/** Local skin colour of the fitted photo (henna excluded), at low resolution, per channel. */
function skinReference(photo: ImageData, mask: ImageData, S = 256) {
  const k = photo.width / S;
  const sum = new Float32Array(S * S * 3);
  const wt = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const o = ((Math.floor(y * k) * photo.width + Math.floor(x * k)) << 2);
      const w = (photo.data[o + 3] / 255) * (1 - mask.data[o + 3] / 255);
      const i = y * S + x;
      wt[i] = w;
      sum[i * 3] = photo.data[o] * w;
      sum[i * 3 + 1] = photo.data[o + 1] * w;
      sum[i * 3 + 2] = photo.data[o + 2] * w;
    }
  // separable box blur (radius r), three passes ≈ gaussian
  const r = 6;
  const blur = (a: Float32Array, ch: number) => {
    const tmp = new Float32Array(a.length);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < S; y++)
        for (let c = 0; c < ch; c++) {
          let acc = 0;
          for (let x = -r; x <= r; x++) acc += a[(y * S + Math.min(S - 1, Math.max(0, x))) * ch + c];
          for (let x = 0; x < S; x++) {
            tmp[(y * S + x) * ch + c] = acc / (2 * r + 1);
            acc += a[(y * S + Math.min(S - 1, x + r + 1)) * ch + c] - a[(y * S + Math.max(0, x - r)) * ch + c];
          }
        }
      for (let x = 0; x < S; x++)
        for (let c = 0; c < ch; c++) {
          let acc = 0;
          for (let y = -r; y <= r; y++) acc += tmp[(Math.min(S - 1, Math.max(0, y)) * S + x) * ch + c];
          for (let y = 0; y < S; y++) {
            a[(y * S + x) * ch + c] = acc / (2 * r + 1);
            acc += tmp[(Math.min(S - 1, y + r + 1) * S + x) * ch + c] - tmp[(Math.max(0, y - r) * S + x) * ch + c];
          }
        }
    }
  };
  blur(sum, 3);
  blur(wt, 1);
  const ref = new Float32Array(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    const w = Math.max(wt[i], 1e-4);
    ref[i * 3] = sum[i * 3] / w;
    ref[i * 3 + 1] = sum[i * 3 + 1] / w;
    ref[i * 3 + 2] = sum[i * 3 + 2] / w;
  }
  return { ref, S, k };
}

/**
 * Builds the model texture for one side. `frameSide` is the side of the hand frame the design was fitted to
 * (palm → model front, back → model back). Returns a JPEG blob, same size as the model's bare texture.
 */
export async function buildModelTexture(mask: ImageData, photo: ImageData, frameSide: Side): Promise<Blob> {
  const side: ModelSide = frameSide === "palm" ? "front" : "back";
  const [L, R, base] = await Promise.all([loadLandmarks(), loadRegions(), loadImageUrl(`/tryon/model/${side}-bare.jpg`)]);
  const W = base.naturalWidth;
  const H = base.naturalHeight;
  const out = imageData(base, W, H);
  const o = out.data;
  const size = mask.width;
  const frame = targetPoints(frameSide).map(([x, y]) => [(x / 1000) * size, (y / 1000) * size] as Pt);
  const { ref, S, k } = skinReference(photo, mask);
  const G = 8; // coarse TPS grid, bilinearly interpolated

  L[side].hands.forEach((hand, h) => {
    let src = frame;
    let mirror = false;
    if (chirality(hand.pts) !== chirality(frame)) {
      mirror = true;
      src = frame.map(([x, y]) => [size - 1 - x, y] as Pt);
    }
    const inv = fitTps(augment(hand.pts), augment(src)); // model pixel → frame pixel
    const gw = Math.ceil(W / G) + 1;
    const gh = Math.ceil(H / G) + 1;
    const grid = new Float32Array(gw * gh * 2);
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const [sx, sy] = inv(gx * G, gy * G);
        grid[(gy * gw + gx) * 2] = sx;
        grid[(gy * gw + gx) * 2 + 1] = sy;
      }
    for (let y = 0; y < H; y++) {
      const gy = Math.min(gh - 2, Math.floor(y / G));
      const fy = y / G - gy;
      for (let x = 0; x < W; x++) {
        // which model hand this pixel belongs to (the back texture is the mirror image of the front outline)
        const rx = side === "front" ? x : W - 1 - x;
        const rch = side === "front" ? (h === 0 ? 0 : 1) : h === 0 ? 1 : 0;
        const region = R.data[((y * R.width + Math.min(R.width - 1, Math.floor((rx * R.width) / W))) << 2) + rch] / 255;
        if (region < 0.02) continue;
        const gx = Math.min(gw - 2, Math.floor(x / G));
        const fx = x / G - gx;
        const i00 = (gy * gw + gx) * 2;
        const i10 = i00 + 2;
        const i01 = i00 + gw * 2;
        const i11 = i01 + 2;
        let sx = (grid[i00] * (1 - fx) + grid[i10] * fx) * (1 - fy) + (grid[i01] * (1 - fx) + grid[i11] * fx) * fy;
        const sy = (grid[i00 + 1] * (1 - fx) + grid[i10 + 1] * fx) * (1 - fy) + (grid[i01 + 1] * (1 - fx) + grid[i11 + 1] * fx) * fy;
        if (mirror) sx = size - 1 - sx;
        if (sx < 0 || sy < 0 || sx >= size - 1 || sy >= size - 1) continue;
        const fi = ((Math.floor(sy) * size + Math.floor(sx)) << 2);
        const a = (mask.data[fi + 3] / 255) * (photo.data[fi + 3] / 255) * region;
        if (a < 0.01) continue;
        const ri = (Math.min(S - 1, Math.floor(sy / k)) * S + Math.min(S - 1, Math.floor(sx / k))) * 3;
        const ti = (y * W + x) << 2;
        for (let c = 0; c < 3; c++) {
          const ratio = Math.min(1.08, Math.max(0.12, photo.data[fi + c] / Math.max(8, ref[ri + c])));
          o[ti + c] = o[ti + c] * (1 - a + a * ratio);
        }
      }
    }
  });

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  c.getContext("2d")!.putImageData(out, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode the model texture"))), "image/jpeg", 0.9));
}
