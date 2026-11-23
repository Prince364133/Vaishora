// The hand expressed in artwork space, derived from the 3D model's bind-pose joints
// (see scripts/extract-landmarks.mjs). Artwork placed with these helpers lines up with
// the fingers and palm of the 3D hand when projected by the mehndi shader.

import landmarks from "./hand-landmarks.json";
import { add, len, lerp, mul, norm, Pt, sub } from "./geometry";

export type Side = "palm" | "back";
export type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";

export interface Finger {
  name: FingerName;
  /** knuckle → … → rounded fingertip end */
  pts: Pt[];
  width: number;
  dir: Pt;
  tipEnd: Pt;
  /** start of the visible finger (knuckle crease on the palm side) */
  base: Pt;
}

export interface Hand2D {
  side: Side;
  wrist: Pt;
  palmCenter: Pt;
  palmRadius: number;
  axis: Pt; // wrist → middle knuckle
  across: Pt; // unit vector across the palm (index → pinky)
  fingers: Record<FingerName, Finger>;
  wristBand: { center: Pt; width: number };
}

// Finger widths in artwork units, measured on the mesh by scripts/extract-landmarks.mjs. The pinky measurement can
// pick up the ring finger next to it, so it is capped relative to the ring finger.
const measured = (landmarks as unknown as { widths: Record<FingerName, number> }).widths;
const WIDTH: Record<FingerName, number> = {
  thumb: measured.thumb * 1.12,
  index: measured.index,
  middle: measured.middle * 1.02,
  ring: measured.ring,
  pinky: Math.min(measured.pinky, measured.ring * 0.88),
};

export function hand2d(side: Side): Hand2D {
  const j = (landmarks as unknown as Record<Side, Record<string, Pt>>)[side];
  const finger = (name: FingerName): Finger => {
    const key = name === "thumb" ? "thumb" : `${name}-finger`;
    const names =
      name === "thumb"
        ? ["thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"]
        : [`${key}-phalanx-proximal`, `${key}-phalanx-intermediate`, `${key}-phalanx-distal`, `${key}-tip`];
    const pts = names.map((n) => j[n] as Pt);
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const dir = norm(sub(last, prev));
    // The model's tip joint is the very end of the finger; stay just inside it.
    const tipEnd = add(last, mul(dir, -WIDTH[name] * 0.06));
    // On the palm the finger starts at the digital crease, about 40% along the proximal phalanx from the knuckle
    // joint; on the back the finger starts right at the knuckle.
    const base = lerp(pts[0], pts[1], name === "thumb" ? 0.1 : side === "palm" ? 0.4 : 0.1);
    const all = [base, ...pts.slice(1, -1), tipEnd];
    return { name, pts: all, width: WIDTH[name], dir: norm(sub(tipEnd, base)), tipEnd, base };
  };
  const fingers = {
    thumb: finger("thumb"),
    index: finger("index"),
    middle: finger("middle"),
    ring: finger("ring"),
    pinky: finger("pinky"),
  };
  const wrist = j["wrist"] as Pt;
  const midKnuckle = j["middle-finger-phalanx-proximal"] as Pt;
  const idx = j["index-finger-phalanx-proximal"] as Pt;
  const pky = j["pinky-finger-phalanx-proximal"] as Pt;
  const axis = norm(sub(midKnuckle, wrist));
  const palmCenter = lerp(wrist, midKnuckle, 0.5);
  const palmRadius = len(sub(idx, pky)) * 0.52;
  return {
    side,
    wrist,
    palmCenter,
    palmRadius,
    axis,
    across: norm(sub(pky, idx)),
    fingers,
    wristBand: { center: add(wrist, mul(axis, 6)), width: len(sub(idx, pky)) * 1.25 },
  };
}

export const FINGERS: FingerName[] = ["index", "middle", "ring", "pinky"];
