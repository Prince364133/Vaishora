import { beforeAll, describe, expect, it } from "vitest";

// Minimal ImageData for Node (the warp code only uses width/height/data).
class NodeImageData {
  data: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

type Warp = typeof import("@/lib/photo-import/warp");
let W: Warp;

beforeAll(async () => {
  (globalThis as unknown as { ImageData: unknown }).ImageData = NodeImageData;
  W = await import("@/lib/photo-import/warp");
});

const SIZE = 256;
function fullCoverage() {
  const c = new NodeImageData(64, 64) as unknown as ImageData;
  for (let i = 3; i < c.data.length; i += 4) c.data[i] = 255;
  return c;
}
function skinPhoto(w: number, h: number) {
  const p = new NodeImageData(w, h) as unknown as ImageData;
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = 222;
    p.data[i + 1] = 170;
    p.data[i + 2] = 140;
    p.data[i + 3] = 255;
  }
  return p;
}
/** Landmarks of a "photo" that is our own frame scaled by k and shifted (same chirality). */
function photoLandmarks(k: number, dx: number, dy: number) {
  return W.targetPoints("palm").map(([x, y]) => [(x / 1000) * SIZE * k + dx, (y / 1000) * SIZE * k + dy] as [number, number]);
}

describe("photo import warp", () => {
  it("maps our hand's joints back onto the photo's landmarks", () => {
    const pts = photoLandmarks(1.5, 40, 20);
    const src = skinPhoto(500, 450);
    const r = W.warpToHand(src, pts, "palm", SIZE, fullCoverage(), 0.5);
    const dst = W.targetPoints("palm").map(([x, y]) => [(x / 1000) * SIZE, (y / 1000) * SIZE]);
    dst.forEach(([x, y], i) => {
      const [sx, sy] = r.toSource(x, y);
      expect(Math.hypot(sx - pts[i][0], sy - pts[i][1])).toBeLessThan(1);
    });
  });

  it("applies photo-space brush edits (add and erase) through the warp", () => {
    const pts = photoLandmarks(1.5, 40, 20);
    const src = skinPhoto(500, 450);
    const palmCentre = W.targetPoints("palm")[9]; // middle-finger knuckle
    const fx = (palmCentre[0] / 1000) * SIZE;
    const fy = (palmCentre[1] / 1000) * SIZE + 20;
    const base = W.warpToHand(src, pts, "palm", SIZE, fullCoverage(), 0.5);
    const at = (img: ImageData, x: number, y: number) => img.data[((Math.round(y) * SIZE + Math.round(x)) << 2) + 3];
    expect(at(base.mask, fx, fy)).toBe(0); // plain skin: no henna

    const edits = W.emptyEdits(src.width, src.height);
    const [sx, sy] = base.toSource(fx, fy);
    W.paintEdit(edits, sx, sy, 12, "add");
    const added = W.warpToHand(src, pts, "palm", SIZE, fullCoverage(), 0.5, edits);
    expect(at(added.mask, fx, fy)).toBeGreaterThan(200);

    W.paintEdit(edits, sx, sy, 12, "erase");
    const erased = W.warpToHand(src, pts, "palm", SIZE, fullCoverage(), 0.5, edits);
    expect(at(erased.mask, fx, fy)).toBeLessThan(10);
  });

  it("exposes the projection frame version", () => {
    expect(W.FRAME_VERSION).toBeGreaterThanOrEqual(1);
  });
});
