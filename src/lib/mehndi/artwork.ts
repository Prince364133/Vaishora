// Original VAISHORA mehndi compositions. Each style composes motifs onto the hand landmarks for the palm and/or back
// of the hand. All artwork is generated in code and owned by the project — no third-party designs are traced or
// reused. Lines are cone-drawn (variable width, blob starts, tapered ends, slight tremor; see cone.ts) so the result
// reads like real henna rather than vector clip-art.

import { dot, inkLine, net, checker, seedInk } from "./cone";
import { add, along, lerp, mul, norm, P, perp, Pt, sub } from "./geometry";
import { FINGERS, Finger, Hand2D, hand2d, Side } from "./hand2d";
import * as M from "./motifs";

export type ArtStyle =
  | "arabic-trail"
  | "floral-vine"
  | "mandala-classic"
  | "bridal-royal"
  | "traditional-full"
  | "modern-geometric"
  | "engagement-ring"
  | "minimal-dots"
  | "arabic-bold-back"
  | "haathphool-back"
  | "feet-classic";

type BandStyle = Parameters<typeof M.band>[4];
const at = (f: Finger, t: number) => along(f.pts, t);

/** Filled fingertip ("dipped" tip) from `from` (0..1 along the finger) to the end, with a slightly wavy edge. */
let capId = 0;

/**
 * Dipped fingertip from `from` (0..1 along the finger) to the end. Real dipped tips are darkest at the very tip and
 * fade slightly towards an irregular edge where the paste ended, so the cap gets a wavy, jittered base edge and an
 * alpha gradient (alpha = stain depth in the shader / 2D composite).
 */
function tipCap(f: Finger, from = 0.84, edge: "straight" | "scallop" | "arch" = "straight") {
  const { p } = at(f, from);
  const d = f.dir;
  const n = perp(d);
  const w = f.width / 2 - 0.5;
  const c = add(f.tipEnd, mul(d, -w));
  const l0 = add(p, mul(n, -w));
  const r0 = add(p, mul(n, w));
  const lt = add(c, mul(n, -w));
  const rt = add(c, mul(n, w));
  const k = 0.56;
  // base edge from r0 to l0: profile (straight / scallop / arch) plus a hand-made wobble
  const seed = f.base[0] * 0.37 + f.base[1] * 0.11 + from * 10;
  const wob = (i: number) => Math.sin(seed + i * 2.3) * 2.6 + Math.sin(seed * 1.7 + i * 5.1) * 1.6;
  const N = 12;
  let base = "";
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const prof = edge === "arch" ? -w * 0.9 * Math.sin(Math.PI * t) : edge === "scallop" ? -6 * Math.abs(Math.sin(2 * Math.PI * t)) : 0;
    const q = add(lerp(r0, l0, t), mul(d, prof + (i < N ? wob(i) : 0)));
    base += `L${P(q)}`;
  }
  const dd = `M${P(r0)}${base}L${P(lt)}C${P(add(lt, mul(d, w * k)))} ${P(add(f.tipEnd, mul(n, -w * k)))} ${P(f.tipEnd)}C${P(add(f.tipEnd, mul(n, w * k)))} ${P(add(rt, mul(d, w * k)))} ${P(rt)}Z`;
  const id = `tip${capId++}`;
  const g0 = add(p, mul(d, edge === "arch" ? -w * 0.5 : 0));
  return (
    `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${P(g0).split(",")[0]}" y1="${P(g0).split(",")[1]}" x2="${P(f.tipEnd).split(",")[0]}" y2="${P(f.tipEnd).split(",")[1]}">` +
    `<stop offset="0" stop-color="currentColor" stop-opacity="0.18"/><stop offset="0.16" stop-color="currentColor" stop-opacity="0.62"/><stop offset="0.45" stop-color="currentColor" stop-opacity="0.9"/><stop offset="1" stop-color="currentColor" stop-opacity="1"/></linearGradient></defs>` +
    `<path d="${dd}" fill="url(#${id})"/>`
  );
}

function fingerBands(f: Finger, ts: number[], styles: BandStyle[], thick = 16) {
  return ts
    .map((t, i) => {
      const { p, dir } = at(f, t);
      return M.band(p, dir, f.width * 0.98, thick, styles[i % styles.length]);
    })
    .join("");
}

function fingerVine(f: Finger, from = 0.05, to = 0.82, leaves = 4) {
  const pts: Pt[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = from + ((to - from) * i) / 6;
    const { p, dir } = at(f, t);
    pts.push(add(p, mul(perp(dir), Math.sin(i * 1.4) * f.width * 0.1)));
  }
  return M.vine(pts, { leaves, leafLen: f.width * 0.5, w: 2.4 });
}

function fingerChevrons(f: Finger, from: number, to: number, n: number) {
  let out = "";
  for (let i = 0; i < n; i++) {
    const t = from + ((to - from) * i) / Math.max(1, n - 1);
    const { p, dir } = at(f, t);
    const nn = perp(dir);
    const w = f.width * 0.42;
    out += inkLine([add(add(p, mul(nn, -w)), mul(dir, -7)), add(p, mul(dir, 7)), add(add(p, mul(nn, w)), mul(dir, -7))], 2.4, { start: "dot", end: "taper" });
  }
  return out;
}

/** Quad covering a finger section between t0 and t1 (for net/checker fills). */
function fingerQuad(f: Finger, t0: number, t1: number): Pt[] {
  const a = at(f, t0);
  const b = at(f, t1);
  const hw = f.width * 0.47;
  return [add(a.p, mul(perp(a.dir), -hw)), add(b.p, mul(perp(b.dir), -hw)), add(b.p, mul(perp(b.dir), hw)), add(a.p, mul(perp(a.dir), hw))];
}

function wristBracelet(h: Hand2D, rows: BandStyle[], thick = 18, gap = 5) {
  let out = "";
  rows.forEach((s, i) => {
    const c = add(h.wristBand.center, mul(h.axis, -i * (thick + gap)));
    out += M.band(c, h.axis, h.wristBand.width, thick, s, 2.6);
  });
  return out;
}

/** Rough palm outline polygon from the landmarks (used to clip fills). */
function palmPoly(h: Hand2D, inset = 0): Pt[] {
  const F = h.fingers;
  const half = h.palmRadius * 1.02 - inset;
  const ix = F.index.base;
  const pk = F.pinky.base;
  return [
    add(ix, mul(h.across, -F.index.width * 0.5 + inset)),
    lerp(ix, F.middle.base, 0.5),
    F.middle.base,
    lerp(F.middle.base, F.ring.base, 0.5),
    F.ring.base,
    lerp(F.ring.base, pk, 0.5),
    add(pk, mul(h.across, F.pinky.width * 0.5 - inset)),
    add(add(h.palmCenter, mul(h.across, half)), mul(h.axis, -h.palmRadius * 0.2)),
    add(h.wrist, mul(h.across, half * 0.85)),
    add(h.wrist, mul(h.across, -half * 0.8)),
    add(add(h.palmCenter, mul(h.across, -half)), mul(h.axis, -h.palmRadius * 0.3)),
  ];
}

/** Forearm section below the bracelets. */
function forearmPoly(h: Hand2D, from: number, to: number, widen = 1): Pt[] {
  const w = h.palmRadius * 0.74 * widen;
  const a = add(h.wrist, mul(h.axis, -from));
  const b = add(h.wrist, mul(h.axis, -to));
  return [add(a, mul(h.across, -w)), add(a, mul(h.across, w)), add(b, mul(h.across, w * 1.05)), add(b, mul(h.across, -w * 1.05))];
}

/** Row of shaded domes along an arc (the arch / jharokha border used in bridal work). */
function domeArc(from: Pt, to: Pt, bulge: number, n: number, size: number) {
  let out = "";
  const pts: Pt[] = [];
  const mid = add(lerp(from, to, 0.5), mul(perp(norm(sub(to, from))), bulge));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(lerp(lerp(from, mid, t), lerp(mid, to, t), t));
  }
  out += inkLine(pts, 2.8, { start: "dot", end: "taper" });
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const up = mul(perp(norm(sub(b, a))), -size);
    const m = add(lerp(a, b, 0.5), up);
    out += M.arcLine(a, b, -size * 1.3, 2.4);
    out += dot(add(lerp(a, b, 0.5), mul(up, 0.45)), size * 0.2);
    out += dot(add(m, mul(up, 0.35)), size * 0.12);
  }
  return out;
}

/** Diagonal Arabic trail from the index finger across the palm to the far side of the wrist. */
function diagonalTrail(h: Hand2D, opts: { bold?: boolean; density?: number }) {
  const { bold = false, density = 1 } = opts;
  const f = h.fingers.index;
  const start = at(f, 0.05).p;
  const mid1 = add(h.palmCenter, mul(h.across, -h.palmRadius * 0.15));
  const mid2 = add(lerp(h.palmCenter, h.wrist, 0.6), mul(h.across, h.palmRadius * 0.4));
  const end = add(h.wrist, mul(h.across, h.palmRadius * 0.75));
  const tail = add(end, mul(h.axis, -90));
  const ang = Math.atan2(h.axis[1], h.axis[0]) + Math.PI / 2;
  let out = M.vine([start, lerp(start, mid1, 0.5), mid1, mid2, end, tail], {
    leaves: Math.round(8 * density),
    leafLen: 40,
    w: bold ? 4.6 : 3.6,
    leafStyle: bold ? "solid" : "half",
  });
  out += M.paisley(lerp(start, mid1, 0.5), 44, ang - 0.7, { style: bold ? "bold" : "shaded", w: 3.2 });
  out += M.rose(mid1, 40, 3.2);
  out += M.paisley(lerp(mid1, mid2, 0.55), 54, ang + 0.6, { style: "shaded", w: 3.2 });
  out += M.dotTrail(add(mid1, mul(h.across, -40)), add(mid1, mul(h.across, -95)), 4, 4);
  if (density > 1) {
    out += M.lotus(add(lerp(mid2, end, 0.5), mul(h.across, -34)), 38, Math.atan2(-h.axis[1], -h.axis[0]) + 0.5, 3);
    out += M.rose(mid2, 32, 3);
    out += M.paisley(lerp(end, tail, 0.5), 40, ang - 0.4, { style: bold ? "bold" : "shaded" });
  }
  return out;
}

function bake(side: Side, style: ArtStyle): string {
  capId = 0;
  const h = hand2d(side);
  seedInk(style.length * 977 + (side === "palm" ? 1 : 2) + style.charCodeAt(0) * 31);
  const { fingers: F } = h;
  const parts: string[] = [];
  const ang = Math.atan2(h.axis[1], h.axis[0]);

  switch (style) {
    case "arabic-trail": {
      parts.push(diagonalTrail(h, { density: 1 }));
      parts.push(fingerVine(F.index, 0.25, 0.75, 3));
      parts.push(tipCap(F.index, 0.8, "arch"), tipCap(F.middle, 0.86));
      parts.push(fingerBands(F.middle, [0.5], ["beads"]));
      parts.push(tipCap(F.thumb, 0.82));
      break;
    }
    case "floral-vine": {
      const c = h.palmCenter;
      if (side === "palm") {
        parts.push(M.lotus(add(c, mul(h.axis, -20)), 48, ang, 3));
        parts.push(M.dotRing(add(c, mul(h.axis, -8)), 88, 18, 3.2));
        for (const name of FINGERS) {
          const f = F[name];
          parts.push(M.vine([lerp(c, f.base, 0.55), lerp(c, f.base, 0.85), at(f, 0.3).p, at(f, 0.6).p], { leaves: 3, leafLen: 24, w: 2.8 }));
          parts.push(fingerBands(f, [0.7], ["scallop"], 14));
          parts.push(tipCap(f, 0.88, "arch"));
        }
        parts.push(M.vine([add(c, mul(h.axis, -95)), lerp(c, h.wrist, 0.85), add(h.wrist, mul(h.axis, -60))], { leaves: 4, leafLen: 26 }));
        parts.push(M.rose(add(h.wrist, mul(h.axis, -80)), 26));
      } else {
        const start = add(h.wrist, mul(h.axis, -40));
        parts.push(M.vine([start, add(lerp(h.wrist, c, 0.5), mul(h.across, -30)), add(c, mul(h.across, -40)), F.index.base, at(F.index, 0.6).p], { leaves: 8, leafLen: 28, w: 3 }));
        parts.push(M.rose(add(c, mul(h.across, -38)), 34));
        parts.push(M.vine([add(c, mul(h.across, -20)), lerp(c, F.middle.base, 0.6), at(F.middle, 0.45).p], { leaves: 3, leafLen: 22, w: 2.6 }));
        parts.push(M.rose(lerp(h.wrist, c, 0.35), 24));
        parts.push(tipCap(F.index, 0.82, "arch"), tipCap(F.middle, 0.86, "arch"));
        parts.push(wristBracelet(h, ["beads"], 14));
      }
      break;
    }
    case "mandala-classic": {
      parts.push(M.mandala(h.palmCenter, h.palmRadius * 0.98, { rings: 4 }));
      for (const name of FINGERS) {
        const f = F[name];
        parts.push(fingerBands(f, [0.18, 0.46], ["net", "beads"], 18));
        parts.push(fingerChevrons(f, 0.6, 0.7, 2));
        parts.push(tipCap(f, 0.8));
      }
      parts.push(fingerBands(F.thumb, [0.35], ["zigzag"]), tipCap(F.thumb, 0.78));
      parts.push(wristBracelet(h, ["beads", "scallop"], 16));
      break;
    }
    case "bridal-royal": {
      const R = h.palmRadius;
      if (side === "palm") {
        const mc = add(h.palmCenter, mul(h.axis, -14));
        const MR = R * 0.92;
        parts.push(M.mandala(mc, MR, { rings: 4, jaal: true, dense: true }));
        // arch of domes across the top of the palm, under the fingers
        const archA = add(F.index.base, mul(h.axis, -30));
        const archB = add(F.pinky.base, mul(h.axis, -30));
        parts.push(domeArc(archA, archB, 24, 6, 18));
        // the rest of the palm is a jaal ground with a shaded keri on the thumb mount
        const keri = add(add(mc, mul(h.across, -R * 0.98)), mul(h.axis, -R * 0.55));
        const top = palmPoly(h, 4).map((q, i) => (i <= 6 ? add(q, mul(h.axis, -62)) : q));
        parts.push(net(top, 14, ang + Math.PI / 4, 1.5, true, [{ c: mc, r: MR + 8 }, { c: keri, r: 40 }]));
        parts.push(M.paisley(keri, 24, ang - Math.PI / 2 - 0.3, { style: "shaded" }));
        // fingers: checker base, net body, beads, filled tip
        for (const name of FINGERS) {
          const f = F[name];
          parts.push(checker(fingerQuad(f, 0.02, 0.2), 9, Math.atan2(f.dir[1], f.dir[0]) + Math.PI / 4, 1.6));
          parts.push(fingerBands(f, [0.24, 0.5], ["lines", "beads"], 10));
          parts.push(net(fingerQuad(f, 0.28, 0.46), 8, Math.atan2(f.dir[1], f.dir[0]) + Math.PI / 4, 1.4, false));
          parts.push(fingerChevrons(f, 0.58, 0.68, 2));
          parts.push(tipCap(f, 0.74, "scallop"));
        }
        parts.push(fingerBands(F.thumb, [0.12, 0.34], ["checker", "beads"], 14), tipCap(F.thumb, 0.8, "arch"));
        parts.push(wristBracelet(h, ["solid", "beads", "checker", "scallop"], 14, 4));
        // forearm: jaal with a lotus, closed by a scalloped edge
        const fp = forearmPoly(h, 92, 250);
        parts.push(net(fp, 15, Math.PI / 4, 1.7, true, [{ c: add(h.wrist, mul(h.axis, -165)), r: 46 }]));
        parts.push(M.lotus(add(h.wrist, mul(h.axis, -170)), 36, ang, 3));
        parts.push(M.band(add(h.wrist, mul(h.axis, -258)), h.axis, h.wristBand.width * 1.15, 14, "scallop"));
      } else {
        const mc = add(h.palmCenter, mul(h.axis, -30));
        parts.push(M.mandala(mc, R * 0.8, { rings: 4, dense: true }));
        parts.push(M.dotRing(mc, R * 0.88, 34, 2.4));
        const ground = palmPoly(h, 6).map((q, i) => (i <= 6 ? add(q, mul(h.axis, -20)) : q));
        parts.push(checker(ground, 16, ang + Math.PI / 4, 1.5, [{ c: mc, r: R * 0.95 }]));
        parts.push(M.peacock(add(add(h.wrist, mul(h.axis, -150)), mul(h.across, 4)), 44, 0, 1));
        for (const name of FINGERS) {
          const f = F[name];
          parts.push(fingerBands(f, [0.12, 0.34], ["beads", "zigzag"], 12));
          parts.push(net(fingerQuad(f, 0.4, 0.58), 8, Math.atan2(f.dir[1], f.dir[0]) + Math.PI / 4, 1.4, false));
          parts.push(fingerBands(f, [0.62], ["lines"], 6));
          parts.push(tipCap(f, 0.8, "arch"));
          parts.push(M.dotTrail(add(f.base, mul(f.dir, -6)), lerp(f.base, mc, 0.55), 4, 3.2));
        }
        parts.push(fingerBands(F.thumb, [0.2, 0.45], ["beads", "checker"], 14), tipCap(F.thumb, 0.74, "arch"));
        parts.push(wristBracelet(h, ["solid", "beads", "net", "scallop"], 14, 4));
        const fp = forearmPoly(h, 92, 250);
        parts.push(net(fp, 15, Math.PI / 4, 1.6, true, [{ c: add(h.wrist, mul(h.axis, -150)), r: 62 }]));
        parts.push(M.band(add(h.wrist, mul(h.axis, -258)), h.axis, h.wristBand.width * 1.15, 14, "scallop"));
      }
      break;
    }
    case "traditional-full": {
      const c = h.palmCenter;
      const holes = [
        { c, r: 70 },
        ...[-1, 1].map((k) => ({ c: add(c, mul(h.across, k * h.palmRadius * 0.62)), r: 46 })),
      ];
      parts.push(checker(palmPoly(h, 6), 20, Math.PI / 4 + ang, 1.8, holes));
      parts.push(M.ring(c, 64, 3.4));
      parts.push(M.sun(c, 50, 2.8));
      for (const k of [-1, 1]) parts.push(M.paisley(add(c, mul(h.across, k * h.palmRadius * 0.62)), 26, ang + Math.PI / 2 + k * 0.3, { style: "shaded" }));
      for (const name of FINGERS) {
        const f = F[name];
        parts.push(fingerBands(f, [0.16, 0.44], ["hatch", "beads"], 14));
        parts.push(fingerVine(f, 0.52, 0.76, 2));
        parts.push(tipCap(f, 0.84));
      }
      parts.push(fingerBands(F.thumb, [0.3], ["hatch"]), tipCap(F.thumb, 0.78));
      parts.push(wristBracelet(h, ["lines", "zigzag", "beads"], 16));
      break;
    }
    case "modern-geometric": {
      const c = h.palmCenter;
      parts.push(M.triangle(c, 58, ang, false, 3.2));
      parts.push(M.triangle(c, 34, ang + Math.PI, true));
      parts.push(M.ring(c, 88, 2.4));
      parts.push(M.dotRing(c, 102, 24, 3));
      for (const name of ["index", "middle", "ring"] as const) {
        const f = F[name];
        parts.push(inkLine([at(f, 0.08).p, at(f, 0.74).p], 2.6, { start: "dot", end: "dot" }));
        parts.push(M.dot(at(f, 0.86).p, 5.5));
        parts.push(fingerChevrons(f, 0.22, 0.6, 3));
      }
      parts.push(M.dotTrail(add(c, mul(h.axis, -115)), add(h.wrist, mul(h.axis, -30)), 6, 6));
      break;
    }
    case "engagement-ring": {
      const ring = F.ring;
      parts.push(fingerBands(ring, [0.18], ["solid"], 10));
      parts.push(M.sun(at(ring, 0.3).p, 18, 2.4));
      parts.push(M.vine([at(ring, 0.38).p, at(ring, 0.6).p, at(ring, 0.78).p], { leaves: 3, leafLen: 16, w: 2.4 }));
      parts.push(tipCap(ring, 0.86, "arch"));
      parts.push(M.mandala(h.palmCenter, h.palmRadius * 0.6, { rings: 3 }));
      parts.push(M.vine([add(h.palmCenter, mul(h.axis, -h.palmRadius * 0.66)), add(h.wrist, mul(h.axis, -30))], { leaves: 4, leafLen: 22 }));
      for (const name of ["index", "middle", "pinky"] as const) parts.push(tipCap(F[name], 0.88));
      break;
    }
    case "minimal-dots": {
      const c = add(h.palmCenter, mul(h.axis, -10));
      parts.push(M.sun(c, 36, 2.6));
      parts.push(M.dotRing(c, 54, 12, 3.4));
      parts.push(M.dotTrail(add(c, mul(h.axis, 64)), F.middle.base, 5, 5));
      parts.push(fingerBands(F.middle, [0.3], ["beads"], 12));
      parts.push(tipCap(F.middle, 0.88, "arch"), tipCap(F.index, 0.9), tipCap(F.ring, 0.9));
      parts.push(M.dotTrail(add(c, mul(h.axis, -64)), add(h.wrist, mul(h.axis, -10)), 5, 4.2));
      break;
    }
    case "arabic-bold-back": {
      parts.push(diagonalTrail(h, { bold: true, density: 1.5 }));
      for (const name of ["index", "middle"] as const) parts.push(fingerVine(F[name], 0.1, 0.68, 3), tipCap(F[name], 0.84, "arch"));
      parts.push(wristBracelet(h, ["solid", "beads"], 12));
      break;
    }
    case "haathphool-back": {
      const c = add(h.palmCenter, mul(h.axis, -16));
      parts.push(M.mandala(c, h.palmRadius * 0.6, { rings: 3, dense: true }));
      for (const name of FINGERS) {
        const f = F[name];
        const ringAt = at(f, 0.3);
        parts.push(M.band(ringAt.p, ringAt.dir, f.width * 0.95, 9, "solid"));
        parts.push(M.sun(add(ringAt.p, mul(ringAt.dir, 15)), 11, 2.2));
        const from = add(ringAt.p, mul(ringAt.dir, -8));
        const to = add(c, mul(norm(sub(from, c)), h.palmRadius * 0.64));
        parts.push(M.dotTrail(from, to, 7, 3.6));
        parts.push(tipCap(f, 0.86, "arch"));
      }
      parts.push(M.dotTrail(add(c, mul(h.axis, h.palmRadius * 0.66)), add(h.wristBand.center, mul(h.axis, 14)), 4, 4));
      parts.push(wristBracelet(h, ["solid", "scallop"], 12));
      break;
    }
    default:
      break;
  }
  return parts.join("");
}

/** Feet artwork is shown as an illustration (the 3D model is a hand). */
function feetArtwork(): string {
  seedInk(4242);
  const c: Pt = [500, 560];
  return [
    M.mandala(c, 110, { rings: 3, dense: true }),
    M.vine([[500, 690], [470, 790], [500, 880]], { leaves: 4, leafLen: 26 }),
    M.band([500, 900], [0, -1], 260, 18, "beads"),
    M.band([500, 928], [0, -1], 260, 16, "scallop"),
    ...[[392, 220], [455, 182], [515, 175], [570, 192], [620, 226]].map(([x, y], i) => dot([x, y] as Pt, i === 0 ? 28 : 18)),
    M.dotTrail([500, 430], [500, 300], 5, 5),
  ].join("");
}

export interface ArtworkOptions {
  color?: string;
  background?: string;
}

/** Full SVG document for a style + side. White by default (texture mask; alpha = stain density). */
export function artworkSvg(style: ArtStyle, side: Side | "feet", opts: ArtworkOptions = {}) {
  const color = opts.color ?? "#ffffff";
  const body = side === "feet" ? feetArtwork() : bake(side, style);
  const bg = opts.background ? `<rect width="1000" height="1000" fill="${opts.background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">${bg}<g fill="${color}" color="${color}">${body}</g></svg>`;
}

export const STYLE_SIDES: Record<ArtStyle, Array<Side | "feet">> = {
  "arabic-trail": ["palm"],
  "floral-vine": ["palm", "back"],
  "mandala-classic": ["palm"],
  "bridal-royal": ["palm", "back"],
  "traditional-full": ["palm", "back"],
  "modern-geometric": ["palm", "back"],
  "engagement-ring": ["palm"],
  "minimal-dots": ["palm", "back"],
  "arabic-bold-back": ["back"],
  "haathphool-back": ["back"],
  "feet-classic": ["feet"],
};
