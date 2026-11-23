// Original mehndi motif library, drawn with the cone-stroke engine (cone.ts).
// Every motif returns SVG markup in artwork space; fills inherit `currentColor` from the artwork group, so the same
// markup is a texture mask (white) or a visible illustration (henna brown).
//
// The vocabulary follows traditional Indian / Pakistani / Arabic mehndi practice — keri (paisley), kamal (lotus),
// mor (peacock), bel (vine) with tendrils, jaal (net) and checker fills, shaded petals, filled fingertips — but every
// shape here is constructed procedurally; nothing is traced from a photograph or another artist's design.

import { checker, dot, fillShape, hatch, ink, inkLine, InkOptions, net, polyOf } from "./cone";
import { add, along, angleOf, len, lerp, mul, norm, P, perp, polar, Pt, sub } from "./geometry";

/** Similarity transform from motif-local units into artwork space. */
export function frame(origin: Pt, angle: number, scale: number) {
  const c = Math.cos(angle) * scale;
  const s = Math.sin(angle) * scale;
  return (p: Pt): Pt => [origin[0] + p[0] * c - p[1] * s, origin[1] + p[0] * s + p[1] * c];
}

export function circleD(c: Pt, r: number, phase = 0) {
  const k = 0.5523 * r;
  const pts = [0, 1, 2, 3].map((i) => phase + (i * Math.PI) / 2);
  let d = `M${P(polar(c, r, pts[0]))}`;
  for (let i = 0; i < 4; i++) {
    const a0 = pts[i];
    const a1 = a0 + Math.PI / 2;
    const p0 = polar(c, r, a0);
    const p1 = polar(c, r, a1);
    const t0: Pt = [-Math.sin(a0), Math.cos(a0)];
    const t1: Pt = [-Math.sin(a1), Math.cos(a1)];
    d += `C${P(add(p0, mul(t0, k)))} ${P(sub(p1, mul(t1, k)))} ${P(p1)}`;
  }
  return d + "Z";
}

export function ring(c: Pt, r: number, w = 3) {
  return ink(circleD(c, r, Math.PI * 2 * ((c[0] * 7 + c[1] * 3) % 1)), w);
}

export { dot };

export function dotRing(c: Pt, r: number, n: number, dr: number, phase = 0) {
  let out = "";
  for (let i = 0; i < n; i++) out += dot(polar(c, r, phase + (i / n) * Math.PI * 2), dr);
  return out;
}

export function dotTrail(from: Pt, to: Pt, n: number, r: number) {
  let out = "";
  for (let i = 0; i < n; i++) out += dot(lerp(from, to, (i + 0.5) / n), r * (1 - (0.45 * i) / n));
  return out;
}

/** Smooth curve through points (Catmull-Rom converted to cubic Bézier). */
export function smoothPath(pts: Pt[]) {
  let d = `M${P(pts[0])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = add(p1, mul(sub(p2, p0), 1 / 6));
    const c2 = sub(p2, mul(sub(p3, p1), 1 / 6));
    d += `C${P(c1)} ${P(c2)} ${P(p2)}`;
  }
  return d;
}

export function line(a: Pt, b: Pt, w = 3, o: InkOptions = {}) {
  return inkLine([a, b], w, o);
}

/** Tendril: a tightening spiral that ends in a dot — the signature flourish of cone work. */
export function curl(at: Pt, dir: Pt, size: number, side: 1 | -1, w = 2.4) {
  const pts: Pt[] = [];
  const a0 = angleOf(dir);
  let ang = a0;
  let p = at;
  let step = size / 6;
  for (let i = 0; i < 22; i++) {
    pts.push(p);
    p = add(p, [Math.cos(ang) * step, Math.sin(ang) * step]);
    ang += side * 0.32;
    step *= 0.9;
  }
  return inkLine(pts, w, { start: "taper", end: "dot" });
}

/** Petal path (pointed tip) from r0 to r1 around centre c at angle a. */
function petalD(c: Pt, r0: number, r1: number, a: number, hw: number, belly = 1.25) {
  const b1 = polar(c, r0, a - hw);
  const b2 = polar(c, r0, a + hw);
  const tip = polar(c, r1, a);
  const c1 = polar(c, r0 + (r1 - r0) * 0.55, a - hw * belly);
  const c2 = polar(c, r1 * 0.98, a - hw * 0.25);
  const c3 = polar(c, r1 * 0.98, a + hw * 0.25);
  const c4 = polar(c, r0 + (r1 - r0) * 0.55, a + hw * belly);
  return `M${P(b1)}C${P(c1)} ${P(c2)} ${P(tip)}C${P(c3)} ${P(c4)} ${P(b2)}`;
}

/**
 * Ring of petals. `fill`:
 *   "line"   outline only (+ optional vein)
 *   "shaded" outline + inner echo filled solid (the deep-shaded petal of bridal work)
 *   "hatch"  outline + fine shading lines
 *   "solid"  fully filled
 */
export function petalRing(
  c: Pt,
  r0: number,
  r1: number,
  n: number,
  opts: { phase?: number; w?: number; fill?: "line" | "shaded" | "hatch" | "solid"; fat?: number; vein?: boolean } = {},
) {
  const { phase = 0, w = 3, fill = "line", fat = 1, vein = fill === "line" } = opts;
  const hw = (Math.PI / n) * 0.92 * fat;
  let out = "";
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const d = petalD(c, r0, r1, a, hw);
    if (fill === "solid") {
      out += fillShape(d + "Z", 0.97, 0);
      continue;
    }
    out += ink(d, w, { start: "dot" });
    if (fill === "shaded") {
      const inner = petalD(c, r0 + (r1 - r0) * 0.12, r0 + (r1 - r0) * 0.72, a, hw * 0.52);
      out += fillShape(inner + "Z", 0.95, 0);
    } else if (fill === "hatch") {
      out += hatch(polyOf(d + "Z"), Math.max(3.2, (r1 - r0) * 0.09), a + Math.PI / 2, w * 0.5, 2.2, 0.8);
    }
    if (vein) out += line(polar(c, r0 + 3, a), polar(c, r0 + (r1 - r0) * 0.7, a), w * 0.6, { start: "dot", end: "taper" });
  }
  return out;
}

export function scallopRing(c: Pt, r: number, n: number, depth: number, w = 3, phase = 0, filledDots = true) {
  let d = "";
  let out = "";
  for (let i = 0; i < n; i++) {
    const a0 = phase + (i / n) * Math.PI * 2;
    const a1 = phase + ((i + 1) / n) * Math.PI * 2;
    const p0 = polar(c, r, a0);
    const p1 = polar(c, r, a1);
    const mid = polar(c, r + depth * 1.7, (a0 + a1) / 2);
    d += `${i === 0 ? `M${P(p0)}` : ""}Q${P(mid)} ${P(p1)}`;
    if (filledDots) out += dot(polar(c, r + depth * 0.45, (a0 + a1) / 2), Math.max(1.6, depth * 0.28));
  }
  return ink(d + "Z", w) + out;
}

/** Spiral rose (a common Arabic / Indo-Arabic filler). */
export function rose(c: Pt, r: number, w = 3, phase = 0) {
  const pts: Pt[] = [];
  for (let i = 0; i <= 70; i++) {
    const t = i / 70;
    pts.push(polar(c, r * 0.6 * t, phase + t * 2.7 * Math.PI * 2));
  }
  let out = inkLine(pts, w, { start: "dot", end: "taper" });
  out += scallopRing(c, r * 0.72, 5, r * 0.18, w, phase, false);
  out += scallopRing(c, r * 1.02, 7, r * 0.13, w * 0.85, phase + 0.3);
  return out;
}

/** Lotus (kamal): layered pointed petals on a cup, shaded. `angle` points from base to the tip. */
export function lotus(base: Pt, size: number, angle: number, w = 3) {
  const T = frame(base, angle + Math.PI / 2, size);
  const petal = (sx: number, tilt: number, h: number) => {
    const q = (x: number, y: number): Pt => T([x * Math.cos(tilt) - y * Math.sin(tilt) + sx, x * Math.sin(tilt) + y * Math.cos(tilt)]);
    return `M${P(q(0, 0))}C${P(q(-0.32 * h, -0.35 * h))} ${P(q(-0.2 * h, -0.8 * h))} ${P(q(0, -h))}C${P(q(0.2 * h, -0.8 * h))} ${P(q(0.32 * h, -0.35 * h))} ${P(q(0, 0))}Z`;
  };
  let out = "";
  const layers: Array<[number, number, number]> = [
    [-0.1, -0.95, 0.78],
    [0.1, 0.95, 0.78],
    [-0.05, -0.45, 0.95],
    [0.05, 0.45, 0.95],
    [0, 0, 1.08],
  ];
  layers.forEach(([sx, tilt, h], i) => {
    const d = petal(sx, tilt, h);
    out += ink(d, w);
    if (i < 2) out += hatch(polyOf(d), size * 0.07, angle + tilt + Math.PI / 2, w * 0.5, 2, 0.8);
    else if (i === 4) out += fillShape(petal(0, 0, 0.62), 0.95, 0);
  });
  // cup and base
  const cupL = T([-0.62, 0.02]), cupR = T([0.62, 0.02]);
  out += ink(`M${P(cupL)}Q${P(T([0, 0.42]))} ${P(cupR)}`, w * 1.1);
  out += ink(`M${P(T([-0.5, 0.16]))}Q${P(T([0, 0.5]))} ${P(T([0.5, 0.16]))}`, w * 0.7);
  for (let i = 0; i < 5; i++) out += dot(T([-0.4 + i * 0.2, 0.42 + Math.abs(i - 2) * -0.05]), w * 0.7);
  return out;
}

/** Keri / paisley with banded echo and a seed-flower core. */
export function paisley(at: Pt, size: number, angle: number, opts: { w?: number; style?: "classic" | "shaded" | "net" | "bold" } = {}) {
  const { w = 3, style = "classic" } = opts;
  const T = frame(at, angle, size);
  const shape = (s: number, ox = 0, oy = 0) => {
    const q = (x: number, y: number) => P(T([x * s + ox, y * s + oy]));
    return `M${q(0, 1)}C${q(-1.1, 1)} ${q(-1.15, -0.3)} ${q(-0.6, -1.0)}C${q(-0.25, -1.5)} ${q(0.3, -1.9)} ${q(0.75, -2.35)}C${q(0.85, -1.6)} ${q(1.05, -1.0)} ${q(1.0, -0.1)}C${q(0.97, 0.6)} ${q(0.55, 1)} ${q(0, 1)}Z`;
  };
  let out = "";
  if (style === "bold") {
    out += fillShape(shape(1), 0.97, w);
    out += `<g fill-opacity="1">${ink(shape(0.55, 0.05, 0.08), w * 0.9)}</g>`;
    return out;
  }
  out += ink(shape(1), w * 1.15);
  out += ink(shape(0.78, 0.03, 0.05), w * 0.8);
  // band between the outlines: scallops of fine strokes (classic) or solid fill (shaded)
  if (style === "shaded") {
    // solid paste along the outer edge, fading inwards as fine strokes (how cone artists shade a keri)
    out += ringFill(polyOf(shape(0.98)), polyOf(shape(0.9, 0.012, 0.02)), 0.95);
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      const a = Math.PI * (0.42 + t * 1.66);
      out += line(T([Math.cos(a) * 0.9, Math.sin(a) * 0.9 + 0.04]), T([Math.cos(a) * 0.8, Math.sin(a) * 0.8 + 0.05]), w * 0.4, { start: "blunt", end: "taper" });
    }
  } else {
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      const a = Math.PI * (0.45 + t * 1.6);
      out += line(T([Math.cos(a) * 0.95, Math.sin(a) * 0.95 + 0.05]), T([Math.cos(a) * 0.8, Math.sin(a) * 0.8 + 0.05]), w * 0.55, { start: "dot", end: "taper" });
    }
  }
  // core
  if (style === "net") {
    out += net(polyOf(shape(0.6, 0.05, 0.08)), size * 0.2, angle + Math.PI / 4, w * 0.5);
  } else {
    const c = T([0.02, 0.12]);
    out += dot(c, size * 0.1);
    out += petalRing(c, size * 0.14, size * 0.42, 7, { w: w * 0.6, fill: "shaded", phase: angle });
  }
  // outer dot fringe
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    const a = Math.PI * (0.5 + t * 1.3);
    out += dot(T([Math.cos(a) * 1.22, Math.sin(a) * 1.22 + 0.05]), w * 0.75);
  }
  out += curl(T([0.75, -2.35]), norm(sub(T([1.1, -2.6]), T([0.75, -2.35]))), size * 0.9, 1, w * 0.7);
  return out;
}

/** Fill the band between an outer and an inner polygon (even-odd) — the solid "shaded" band of a motif. */
export function ringFill(outer: Pt[], inner: Pt[], alpha = 0.95) {
  const toD = (p: Pt[]) => `M${p.map(P).join("L")}Z`;
  return `<path fill-rule="evenodd" d="${toD(outer)}${toD(inner)}" fill-opacity="${alpha.toFixed(2)}"/>`;
}

export function leaf(base: Pt, dir: Pt, length: number, width: number, opts: { w?: number; style?: "vein" | "shaded" | "solid" | "half" } = {}) {
  const { w = 2.6, style = "vein" } = opts;
  const d = norm(dir);
  const n = perp(d);
  const tip = add(base, mul(d, length));
  const c1 = add(add(base, mul(d, length * 0.3)), mul(n, width));
  const c2 = add(add(base, mul(d, length * 0.75)), mul(n, width * 0.8));
  const c3 = add(add(base, mul(d, length * 0.75)), mul(n, -width * 0.8));
  const c4 = add(add(base, mul(d, length * 0.3)), mul(n, -width));
  const body = `M${P(base)}C${P(c1)} ${P(c2)} ${P(tip)}C${P(c3)} ${P(c4)} ${P(base)}Z`;
  if (style === "solid") return fillShape(body, 0.96, w * 0.7);
  let out = ink(body, w);
  if (style === "half") {
    const half = `M${P(base)}C${P(c1)} ${P(c2)} ${P(tip)}L${P(base)}Z`;
    out += fillShape(half, 0.94, 0);
    return out;
  }
  out += line(base, lerp(base, tip, 0.85), w * 0.65, { start: "dot" });
  if (style === "shaded") {
    out += hatch(polyOf(body), Math.max(3, width * 0.32), angleOf(d) + Math.PI / 3, w * 0.45, 1.5, 0.8);
  } else {
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const m = lerp(base, tip, t * 0.85);
      for (const s of [1, -1]) {
        const e = add(add(m, mul(d, length * 0.12)), mul(n, s * width * 0.55 * (1 - t * 0.4)));
        out += line(m, e, w * 0.45, { start: "taper" });
      }
    }
  }
  return out;
}

/** Bel: flowing vine with alternating leaves, tendrils and dot buds. */
export function vine(pts: Pt[], opts: { w?: number; leaves?: number; leafLen?: number; curls?: boolean; leafStyle?: "vein" | "shaded" | "solid" | "half" } = {}) {
  const { w = 3, leaves = 6, leafLen = 32, curls = true, leafStyle = "half" } = opts;
  let out = ink(smoothPath(pts), w, { start: "dot", end: "taper" });
  for (let i = 0; i < leaves; i++) {
    const t = (i + 0.5) / leaves;
    const { p, dir } = along(pts, t);
    const side = i % 2 === 0 ? 1 : -1;
    const ld = norm(add(mul(dir, 0.7), mul(perp(dir), side)));
    out += leaf(p, ld, leafLen * (0.85 + 0.3 * Math.sin(i * 1.7)), leafLen * 0.34, { w: w * 0.8, style: leafStyle });
    if (curls && i % 2 === 1) {
      const cd = norm(add(dir, mul(perp(dir), -side * 0.9)));
      out += curl(p, cd, leafLen * 0.8, side as 1 | -1, w * 0.7);
    } else if (curls) {
      out += dot(add(p, mul(perp(dir), -side * leafLen * 0.35)), w * 0.8);
    }
  }
  return out;
}

/** Peacock (mor): body as a shaded paisley curve, crest, beak and a fan of eyed tail feathers. */
export function peacock(at: Pt, size: number, angle: number, facing: 1 | -1 = 1, w = 2.8) {
  const T0 = frame(at, angle, size);
  const T = (p: Pt): Pt => T0([p[0] * facing, p[1]]);
  const q = (x: number, y: number) => P(T([x, y]));
  let out = "";
  // neck + head + body as one flowing outline
  const body = `M${q(0.2, 0.9)}C${q(-0.55, 0.85)} ${q(-0.65, 0.1)} ${q(-0.25, -0.35)}C${q(-0.05, -0.6)} ${q(-0.15, -1.0)} ${q(-0.05, -1.25)}C${q(0.05, -1.45)} ${q(0.32, -1.42)} ${q(0.34, -1.22)}C${q(0.36, -1.05)} ${q(0.12, -0.95)} ${q(0.16, -0.62)}C${q(0.2, -0.3)} ${q(0.62, 0.0)} ${q(0.55, 0.45)}C${q(0.5, 0.8)} ${q(0.35, 0.9)} ${q(0.2, 0.9)}Z`;
  out += ink(body, w * 1.1);
  out += hatch(polyOf(body), size * 0.06, angle + 0.9 * facing, w * 0.45, 1.6, 0.85);
  // eye, beak, crest
  out += dot(T([0.12, -1.24]), w * 0.9);
  out += fillShape(`M${q(0.33, -1.27)}L${q(0.55, -1.2)}L${q(0.33, -1.14)}Z`, 0.95, 0);
  for (let i = 0; i < 3; i++) {
    const a: Pt = T([0.0 + i * 0.1, -1.42]);
    const b: Pt = T([-0.1 + i * 0.16, -1.72]);
    out += line(a, b, w * 0.55, { start: "taper", end: "dot" });
  }
  // wing: scallops on the body
  for (let i = 0; i < 3; i++) out += ink(`M${q(-0.3 + i * 0.12, 0.05 + i * 0.2)}Q${q(0.05 + i * 0.1, 0.0 + i * 0.25)} ${q(0.35, 0.25 + i * 0.2)}`, w * 0.6);
  // tail feathers fanning down and back, each ending in an "eye"
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.55 + i * 0.11);
    const base: Pt = [0.15, 0.85];
    const len1 = 1.3 + 0.25 * Math.sin(i * 1.3);
    const tip: Pt = [base[0] - Math.cos(a) * len1, base[1] + Math.sin(a) * len1];
    const mid: Pt = lerp(base, tip, 0.55);
    out += ink(`M${q(base[0], base[1])}Q${q(mid[0] + 0.12, mid[1])} ${q(tip[0], tip[1])}`, w * 0.7);
    const eyeC = T(tip);
    const dir = norm(sub(eyeC, T(mid)));
    out += leaf(sub(eyeC, mul(dir, size * 0.05)), dir, size * 0.36, size * 0.13, { w: w * 0.6, style: "half" });
    out += dot(add(eyeC, mul(dir, size * 0.14)), w * 1.1);
  }
  return out;
}

/** Concentric mandala built from rings; `scale` is the outer radius. */
export function mandala(c: Pt, scale: number, opts: { w?: number; rings?: number; jaal?: boolean; phase?: number; dense?: boolean } = {}) {
  const { w = 3, rings = 4, jaal = false, phase = 0, dense = false } = opts;
  const R = scale;
  let out = dot(c, R * 0.06);
  out += petalRing(c, R * 0.08, R * 0.2, 8, { w: w * 0.8, fill: "shaded", phase });
  out += ring(c, R * 0.23, w * 0.9);
  out += dotRing(c, R * 0.27, 18, w * 0.6, phase);
  out += petalRing(c, R * 0.3, R * 0.5, 10, { w, fill: dense ? "shaded" : "hatch", phase });
  if (rings >= 2) {
    out += ring(c, R * 0.53, w * 0.9);
    if (jaal) out += annulusNet(c, R * 0.535, R * 0.67, R * 0.045, w * 0.45);
    else out += petalRing(c, R * 0.54, R * 0.67, 22, { w: w * 0.7, fill: "solid", fat: 0.5, phase });
    out += ring(c, R * 0.69, w * 0.9);
  }
  if (rings >= 3) {
    out += petalRing(c, R * 0.71, R * 0.9, 14, { w, fill: "shaded", phase: phase + Math.PI / 14 });
    out += dotRing(c, R * 0.94, 28, w * 0.6, phase);
  }
  if (rings >= 4) {
    out += scallopRing(c, R * 0.98, 28, R * 0.05, w * 0.8, phase);
  }
  return out;
}

/** Crossed diagonal strokes filling an annulus (a ring of jaal). */
export function annulusNet(c: Pt, r0: number, r1: number, spacing: number, w = 1.6) {
  let out = "";
  const n = Math.round((r1 * Math.PI * 2) / spacing);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    out += line(polar(c, r0, a), polar(c, r1, b), w, { start: "taper", end: "taper" });
    out += line(polar(c, r0, b), polar(c, r1, a), w, { start: "taper", end: "taper" });
  }
  return out;
}

/** A band across a finger / wrist at point `p`, perpendicular to direction `dir`. */
export function band(
  p: Pt,
  dir: Pt,
  width: number,
  thickness: number,
  style: "lines" | "dots" | "zigzag" | "hatch" | "solid" | "scallop" | "net" | "checker" | "beads",
  w = 2.6,
) {
  const d = norm(dir);
  const n = perp(d);
  const hw = width / 2;
  const a = add(p, mul(d, -thickness / 2));
  const b = add(p, mul(d, thickness / 2));
  const quad: Pt[] = [add(a, mul(n, -hw)), add(a, mul(n, hw)), add(b, mul(n, hw)), add(b, mul(n, -hw))];
  const edge = (o: Pt) => line(add(o, mul(n, -hw)), add(o, mul(n, hw)), w, { start: "taper", end: "taper" });
  if (style === "solid") return fillShape(`M${quad.map(P).join("L")}Z`, 0.97, w * 0.6);
  let out = edge(a) + edge(b);
  const steps = Math.max(3, Math.round(width / Math.max(9, thickness * 0.85)));
  if (style === "dots" || style === "beads") {
    for (let i = 0; i < steps; i++) out += dot(add(p, mul(n, -hw + ((i + 0.5) / steps) * width)), Math.min(thickness * (style === "beads" ? 0.32 : 0.2), 7));
  } else if (style === "zigzag") {
    const zz: Pt[] = [];
    for (let i = 0; i <= steps; i++) zz.push(add(i % 2 ? b : a, mul(n, -hw + (i / steps) * width)));
    out += inkLine(zz, w * 0.8, { start: "taper", end: "taper" });
    for (let i = 0; i < steps; i++) out += dot(add(i % 2 ? lerp(a, p, 0.45) : lerp(b, p, 0.45), mul(n, -hw + ((i + 0.5) / steps) * width)), w * 0.6);
  } else if (style === "hatch") {
    out += hatch(quad, Math.max(3.5, thickness * 0.24), angleOf(d) + Math.PI / 4, w * 0.55, 0.5, 0.9);
  } else if (style === "net") {
    out += net(quad, Math.max(6, thickness * 0.5), angleOf(d) + Math.PI / 4, w * 0.5, false);
  } else if (style === "checker") {
    out += checker(quad, Math.max(6, thickness * 0.5), angleOf(d) + Math.PI / 4, w * 0.45);
  } else if (style === "scallop") {
    let ds = "";
    for (let i = 0; i < steps; i++) {
      const s0 = add(b, mul(n, -hw + (i / steps) * width));
      const s1 = add(b, mul(n, -hw + ((i + 1) / steps) * width));
      const m = add(lerp(s0, s1, 0.5), mul(d, thickness * 0.75));
      ds += `${i ? "" : `M${P(s0)}`}Q${P(m)} ${P(s1)}`;
      out += dot(add(lerp(s0, s1, 0.5), mul(d, thickness * 0.3)), Math.max(1.5, w * 0.7));
    }
    out += ink(ds, w * 0.8);
  }
  return out;
}

export function arcLine(from: Pt, to: Pt, bulge: number, w = 3) {
  const m = lerp(from, to, 0.5);
  const n = perp(norm(sub(to, from)));
  return ink(`M${P(from)}Q${P(add(m, mul(n, bulge)))} ${P(to)}`, w);
}

export function triangle(c: Pt, r: number, angle: number, filled = false, w = 3) {
  const pts = [0, 1, 2].map((i) => polar(c, r, angle + (i * Math.PI * 2) / 3));
  const d = `M${pts.map(P).join("L")}Z`;
  return filled ? fillShape(d, 0.96, w * 0.6) : ink(d, w);
}

/** Small sun / flower: shaded petals around a dot. */
export function sun(c: Pt, r: number, w = 3) {
  return dot(c, r * 0.22) + ring(c, r * 0.34, w * 0.8) + petalRing(c, r * 0.4, r, 10, { w: w * 0.8, fill: "shaded" });
}

export { angleOf, len };
