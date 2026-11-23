// Cone-drawn line engine for the mehndi artwork generator.
//
// Real henna is piped from a cone: the paste line starts with a small blob where the cone touches the skin, its
// width swells and thins with hand pressure, it wobbles very slightly, and it ends in a taper (or a dot) where the
// artist lifts off. Uniform SVG strokes read as "vector clip-art"; this module turns centre-line paths into filled,
// variable-width outlines with exactly those properties. Everything is deterministic (seeded) so a design renders
// identically everywhere.
//
// Units: artwork space (1000 x 1000 for a 0.255 m frame, so 1 unit ≈ 0.25 mm).

import { add, f, len, lerp, mul, norm, perp, Pt, rng, sub } from "./geometry";

let rand = rng(1);
/** Reset the stroke RNG (call once per artwork so output is deterministic). */
export function seedInk(seed: number) {
  rand = rng(seed);
}
const r = () => rand();
const jitter = (a: number) => (r() * 2 - 1) * a;

// ------------------------------------------------------------------ path sampling
/** Parses the absolute M/L/C/Q/Z subset produced by this library and samples it into polylines. */
export function samplePath(d: string, step = 3): Pt[][] {
  const tokens = d.match(/[MLCQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let p: Pt = [0, 0];
  let start: Pt = [0, 0];
  let i = 0;
  let cmd = "M";
  const num = () => parseFloat(tokens[i++]);
  const pt = (): Pt => [num(), num()];
  const seg = (fn: (t: number) => Pt, approxLen: number) => {
    const n = Math.max(1, Math.ceil(approxLen / step));
    for (let k = 1; k <= n; k++) cur.push(fn(k / n));
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[MLCQZ]/i.test(t)) {
      cmd = t.toUpperCase();
      i++;
      if (cmd === "Z") {
        if (cur.length) {
          cur.push(start);
          out.push(cur);
        }
        cur = [];
        p = start;
        continue;
      }
    }
    if (cmd === "M") {
      if (cur.length > 1) out.push(cur);
      p = start = pt();
      cur = [p];
      cmd = "L";
    } else if (cmd === "L") {
      const q = pt();
      const a = p;
      seg((u) => lerp(a, q, u), len(sub(q, a)));
      p = q;
    } else if (cmd === "Q") {
      const c = pt();
      const q = pt();
      const a = p;
      seg((u) => lerp(lerp(a, c, u), lerp(c, q, u), u), len(sub(c, a)) + len(sub(q, c)));
      p = q;
    } else if (cmd === "C") {
      const c1 = pt();
      const c2 = pt();
      const q = pt();
      const a = p;
      seg((u) => {
        const ab = lerp(a, c1, u), bc = lerp(c1, c2, u), cd = lerp(c2, q, u);
        return lerp(lerp(ab, bc, u), lerp(bc, cd, u), u);
      }, len(sub(c1, a)) + len(sub(c2, c1)) + len(sub(q, c2)));
      p = q;
    } else {
      i++;
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function resample(pts: Pt[], step: number): Pt[] {
  const res: Pt[] = [pts[0]];
  let carry = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const l = len(sub(b, a));
    let d = step - carry;
    while (d <= l) {
      res.push(lerp(a, b, d / l));
      d += step;
    }
    carry = l - (d - step);
  }
  const last = pts[pts.length - 1];
  if (len(sub(last, res[res.length - 1])) > step * 0.3) res.push(last);
  else res[res.length - 1] = last;
  return res;
}

const num1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** Compact path: absolute start, then relative line segments. */
function polyPath(poly: Pt[]) {
  let d = `M${f(poly[0][0])} ${f(poly[0][1])}`;
  let prev = [Math.round(poly[0][0] * 10) / 10, Math.round(poly[0][1] * 10) / 10];
  for (let k = 1; k < poly.length; k++) {
    const x = Math.round(poly[k][0] * 10) / 10;
    const y = Math.round(poly[k][1] * 10) / 10;
    const dx = num1(x - prev[0]);
    const dy = num1(y - prev[1]);
    d += `l${dx}${dy.startsWith("-") ? dy : " " + dy}`;
    prev = [x, y];
  }
  return d + "z";
}

const op = (a: number) => (a >= 0.995 ? "" : ` fill-opacity="${a.toFixed(2)}"`);

// ------------------------------------------------------------------ strokes
export interface InkOptions {
  /** how the line starts: a small paste blob (default) or a fine taper */
  start?: "dot" | "taper" | "blunt";
  /** how the line ends: lift-off taper (default), a dot, or blunt */
  end?: "taper" | "dot" | "blunt";
  /** paste density 0..1 → stain depth (default 0.92..1, randomised) */
  alpha?: number;
  /** amount of pressure variation (default 1) */
  pressure?: number;
}

/** One cone stroke along a polyline. */
export function inkLine(ptsIn: Pt[], w: number, o: InkOptions = {}): string {
  if (ptsIn.length < 2) return "";
  const total = ptsIn.slice(1).reduce((s, p, k) => s + len(sub(p, ptsIn[k])), 0);
  if (total < 0.5) return dot(ptsIn[0], w * 0.6, o.alpha);
  const step = Math.max(1.6, Math.min(5, w * 0.9, total / 4));
  const pts = resample(ptsIn, step);
  const n = pts.length;
  const pr = o.pressure ?? 1;
  const ph1 = r() * 6.28, ph2 = r() * 6.28, f1 = 0.02 + r() * 0.03, f2 = 0.07 + r() * 0.05;
  const wob = Math.min(0.7, 0.18 + w * 0.06);
  const left: Pt[] = [];
  const right: Pt[] = [];
  let s = 0;
  const startTaper = o.start === "taper" ? Math.min(total * 0.3, 10 + w * 2) : Math.min(total * 0.2, 3 + w);
  const endTaper = o.end === "blunt" ? 0 : Math.min(total * 0.35, 8 + w * 3);
  for (let k = 0; k < n; k++) {
    if (k) s += len(sub(pts[k], pts[k - 1]));
    const a = pts[Math.max(0, k - 1)];
    const b = pts[Math.min(n - 1, k + 1)];
    const nn = perp(norm(sub(b, a)));
    // pressure: slow swell + faster flutter
    let ww = w * (1 + pr * (0.13 * Math.sin(s * f1 + ph1) + 0.06 * Math.sin(s * f2 + ph2)));
    if (o.start === "taper") ww *= 0.35 + 0.65 * Math.min(1, s / startTaper);
    else ww *= 0.8 + 0.2 * Math.min(1, s / Math.max(startTaper, 0.1));
    if (endTaper > 0) {
      const u = Math.min(1, (total - s) / endTaper);
      ww *= o.end === "dot" ? 0.75 + 0.25 * u : 0.22 + 0.78 * Math.sqrt(u);
    }
    // hand tremor: tiny low-frequency sideways drift
    const drift = wob * Math.sin(s * 0.045 + ph2) * 0.6 + wob * 0.4 * Math.sin(s * 0.16 + ph1);
    const c = add(pts[k], mul(nn, drift));
    left.push(add(c, mul(nn, ww / 2)));
    right.push(add(c, mul(nn, -ww / 2)));
  }
  const alpha = o.alpha ?? 0.9 + r() * 0.1;
  let out = `<path d="${polyPath([...left, ...right.reverse()])}"${op(alpha)}/>`;
  if ((o.start ?? "dot") === "dot") out += dot(pts[0], w * (0.62 + r() * 0.12), Math.min(1, alpha + 0.04));
  if (o.end === "dot") out += dot(pts[n - 1], w * (0.85 + r() * 0.2), alpha);
  return out;
}

/** Cone strokes for every sub-path of an SVG path string (M/L/C/Q/Z). */
export function ink(d: string, w: number, o: InkOptions = {}): string {
  return samplePath(d, Math.max(1.5, w * 0.8))
    .map((pts) => {
      const closed = len(sub(pts[0], pts[pts.length - 1])) < 0.5;
      // closed loops: the artist overlaps the start a little and lifts off with a taper
      if (closed && pts.length > 3) return inkLine([...pts, pts[1], pts[2]], w, { start: "taper", end: "taper", ...o });
      return inkLine(pts, w, o);
    })
    .join("");
}

/** A slightly irregular paste dot. */
export function dot(c: Pt, rad: number, alpha?: number): string {
  const rx = rad * (1 + jitter(0.08));
  const ry = rad * (1 + jitter(0.08));
  const a = (r() * 180).toFixed(0);
  return `<ellipse cx="${f(c[0])}" cy="${f(c[1])}" rx="${f(rx)}" ry="${f(ry)}" transform="rotate(${a} ${f(c[0])} ${f(c[1])})"${op(alpha ?? 0.95 + r() * 0.05)}/>`;
}

/** Filled shape (dense paste) with a slightly irregular cone outline so the edge is not machine-perfect. */
export function fillShape(d: string, alpha = 1, outline = 3): string {
  const polys = samplePath(d, 3);
  return polys.map((p) => `<path d="${polyPath(p)}"${op(alpha)}/>`).join("") + (outline ? ink(d, outline, { start: "taper", alpha }) : "");
}

// ------------------------------------------------------------------ fills (clipped to a polygon)
/** Circular areas a fill must leave empty (where a motif sits on top of a jaal / checker ground). */
export type Holes = Array<{ c: Pt; r: number }>;
const inHole = (p: Pt, holes: Holes) => holes.some((h) => len(sub(p, h.c)) < h.r);

/** Split a segment into the runs that lie outside the holes. */
function outsideRuns(a: Pt, b: Pt, holes: Holes): Array<[Pt, Pt]> {
  if (!holes.length) return [[a, b]];
  const l = len(sub(b, a));
  const n = Math.max(2, Math.ceil(l / 2));
  const runs: Array<[Pt, Pt]> = [];
  let s: Pt | null = null;
  let prev = a;
  for (let k = 0; k <= n; k++) {
    const p = lerp(a, b, k / n);
    const out = !inHole(p, holes);
    if (out && !s) s = p;
    if (!out && s) {
      runs.push([s, prev]);
      s = null;
    }
    prev = p;
  }
  if (s) runs.push([s, b]);
  return runs;
}
export function pointInPoly(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Segments of the infinite line through `o` with direction `dir` that lie inside `poly`. */
function clipLine(o: Pt, dir: Pt, poly: Pt[]): Array<[Pt, Pt]> {
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const e = sub(b, a);
    const den = dir[0] * e[1] - dir[1] * e[0];
    if (Math.abs(den) < 1e-9) continue;
    const ao = sub(a, o);
    const t = (ao[0] * e[1] - ao[1] * e[0]) / den;
    const u = (ao[0] * dir[1] - ao[1] * dir[0]) / den;
    if (u >= 0 && u < 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const segs: Array<[Pt, Pt]> = [];
  for (let k = 0; k + 1 < ts.length; k += 2) segs.push([add(o, mul(dir, ts[k])), add(o, mul(dir, ts[k + 1]))]);
  return segs;
}

function bounds(poly: Pt[]) {
  let cx = 0, cy = 0;
  for (const p of poly) {
    cx += p[0];
    cy += p[1];
  }
  const c: Pt = [cx / poly.length, cy / poly.length];
  const rad = Math.max(...poly.map((p) => len(sub(p, c))));
  return { c, rad };
}

/** Parallel shading lines inside a shape (the "shaded" fill of traditional work). */
export function hatch(poly: Pt[], spacing: number, angle: number, w = 1.8, inset = 2.5, alpha = 0.85, holes: Holes = []): string {
  const { c, rad } = bounds(poly);
  const dir: Pt = [Math.cos(angle), Math.sin(angle)];
  const n = perp(dir);
  let out = "";
  for (let k = -rad; k <= rad; k += spacing) {
    for (const [a, b] of clipLine(add(c, mul(n, k + jitter(spacing * 0.08))), dir, poly).flatMap(([a0, b0]) => outsideRuns(a0, b0, holes))) {
      const l = len(sub(b, a));
      if (l < inset * 2 + 2) continue;
      const da = norm(sub(b, a));
      out += inkLine([add(a, mul(da, inset)), add(b, mul(da, -inset))], w, { start: "taper", end: "taper", alpha, pressure: 0.6 });
    }
  }
  return out;
}

/** Net / jaal: two crossing hatch directions with dots in the cells. */
export function net(poly: Pt[], spacing: number, angle = Math.PI / 4, w = 1.8, dots = true, holes: Holes = []): string {
  let out = hatch(poly, spacing, angle, w, 1.5, 0.9, holes) + hatch(poly, spacing, angle + Math.PI / 2, w, 1.5, 0.9, holes);
  if (dots) {
    const { c, rad } = bounds(poly);
    const d1: Pt = [Math.cos(angle), Math.sin(angle)];
    const d2: Pt = [Math.cos(angle + Math.PI / 2), Math.sin(angle + Math.PI / 2)];
    for (let i = -rad; i <= rad; i += spacing) {
      for (let j = -rad; j <= rad; j += spacing) {
        const p = add(c, add(mul(d1, i + spacing / 2), mul(d2, j + spacing / 2)));
        if (pointInPoly(p, poly) && !inHole(p, holes)) out += dot(p, Math.min(spacing * 0.13, w * 1.1));
      }
    }
  }
  return out;
}

/** Checkered fill: alternate cells filled solid, outlines piped. */
export function checker(poly: Pt[], cell: number, angle = Math.PI / 4, w = 1.8, holes: Holes = []): string {
  const { c, rad } = bounds(poly);
  const d1: Pt = [Math.cos(angle), Math.sin(angle)];
  const d2: Pt = perp(d1);
  let out = hatch(poly, cell, angle, w, 0.5, 0.95, holes) + hatch(poly, cell, angle + Math.PI / 2, w, 0.5, 0.95, holes);
  for (let i = Math.floor(-rad / cell); i * cell <= rad; i++) {
    for (let j = Math.floor(-rad / cell); j * cell <= rad; j++) {
      if ((i + j) % 2 !== 0) continue;
      const o = add(c, add(mul(d1, i * cell), mul(d2, j * cell)));
      const q: Pt[] = [o, add(o, mul(d1, cell)), add(add(o, mul(d1, cell)), mul(d2, cell)), add(o, mul(d2, cell))];
      if (!q.every((p) => pointInPoly(p, poly) && !inHole(p, holes))) continue;
      const ins = q.map((p) => lerp(p, add(o, mul(add(d1, d2), cell / 2)), 0.12));
      out += `<path d="${polyPath(ins)}"${op(0.93 + r() * 0.07)}/>`;
    }
  }
  return out;
}

/** Sample a closed shape path into a polygon (for fills). */
export function polyOf(d: string): Pt[] {
  return samplePath(d, 4)[0] ?? [];
}
