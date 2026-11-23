// Small 2D geometry + seeded randomness helpers for the mehndi artwork generator.
// Artwork space is 1000 x 1000 SVG units; fingertips point up (negative y).

export type Pt = [number, number];

export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s];
export const len = (a: Pt) => Math.hypot(a[0], a[1]);
export const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
export const perp = (a: Pt): Pt => [-a[1], a[0]];
export const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const angleOf = (a: Pt) => Math.atan2(a[1], a[0]);
export const polar = (c: Pt, r: number, a: number): Pt => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
export const deg = (r: number) => (r * 180) / Math.PI;

export const f = (n: number) => (Math.round(n * 10) / 10).toString();
export const P = (p: Pt) => `${f(p[0])},${f(p[1])}`;

/** Mulberry32 — deterministic so every design renders identically everywhere. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Point along a polyline at normalised distance t (0..1), plus the local direction. */
export function along(points: Pt[], t: number): { p: Pt; dir: Pt } {
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const l = len(sub(points[i + 1], points[i]));
    segs.push(l);
    total += l;
  }
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const k = segs[i] ? Math.min(1, d / segs[i]) : 0;
      return { p: lerp(points[i], points[i + 1], k), dir: norm(sub(points[i + 1], points[i])) };
    }
    d -= segs[i];
  }
  return { p: points[points.length - 1], dir: [0, -1] };
}
