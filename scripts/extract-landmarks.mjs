// Extracts hand landmarks from the realistic hand GLB and writes them in "artwork space"
// (1000x1000 SVG units) for the palm and back projections, plus the projection frame used by the shader.
// Usage: node scripts/extract-landmarks.mjs [public/models/hand-hq.glb]
//
// Model convention (see scripts/hand-real/build_hand.py): metres, palm faces -X, fingers point -Y,
// joint empties named like WebXR hand joints (wrist, index-finger-phalanx-proximal, ...).
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const file = process.argv[2] ?? "public/models/hand-hq.glb";
const buf = fs.readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

new GLTFLoader().parse(ab, "", (gltf) => {
  gltf.scene.updateMatrixWorld(true);
  let mesh;
  gltf.scene.traverse((o) => o.isMesh && (mesh = o));
  const g = mesh.geometry;
  g.computeBoundingBox();
  const armMaxY = g.boundingBox.max.y;
  // The projection frame covers the hand region only (fingertips → 8.5 cm below the wrist joint, which sits at
  // y = 0). The long forearm beyond it is mostly out of frame and gets no artwork, so it must not dilute the frame.
  const bb = new THREE.Box3();
  {
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (v.y <= 0.085) bb.expandByPoint(v);
    }
  }
  const size = Math.max(bb.max.y - bb.min.y, bb.max.z - bb.min.z) * 1.04;
  const cy = (bb.max.y + bb.min.y) / 2;
  const cz = (bb.max.z + bb.min.z) / 2;
  // Projection frame shared with the shader (src/components/hand/mehndiMaterial.ts)
  const frame = { axisU: "z", axisV: "y", centerU: cz, centerV: cy, size, palmNormalX: -1, minY: bb.min.y, maxY: bb.max.y, armMaxY };
  // SVG coords: x right, y down; fingertips at the top.
  const toPalm = (p) => [(0.5 - (p.z - cz) / size) * 1000, (0.5 - (cy - p.y) / size) * 1000];
  const toBack = (p) => [(0.5 + (p.z - cz) / size) * 1000, (0.5 - (cy - p.y) / size) * 1000];
  const joints = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh && /finger|thumb|wrist/.test(o.name)) joints[o.name] = o.getWorldPosition(new THREE.Vector3());
  });
  const round = (v) => Math.round(v * 10) / 10;
  const proj = (fn) => Object.fromEntries(Object.entries(joints).map(([k, p]) => [k, fn(p).map(round)]));

  // Finger widths (artwork units) measured on the mesh at the middle of the proximal phalanx.
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const widths = {};
  for (const [name, a, b] of [
    ["thumb", "thumb-phalanx-proximal", "thumb-phalanx-distal"],
    ["index", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate"],
    ["middle", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate"],
    ["ring", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate"],
    ["pinky", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate"],
  ]) {
    const p0 = joints[a];
    const p1 = joints[b];
    const mid = p0.clone().lerp(p1, 0.55);
    const dir = p1.clone().sub(p0).normalize();
    // across = direction perpendicular to the finger inside the projection (y,z) plane
    const across = new THREE.Vector3(0, -dir.z, dir.y).normalize();
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).sub(mid);
      if (Math.abs(v.dot(dir)) > 0.0025) continue;
      // stay on this finger: perpendicular distance from its axis below ~1 cm (neighbours start further out)
      if (v.clone().sub(dir.clone().multiplyScalar(v.dot(dir))).length() > 0.0105) continue;
      const s = v.dot(across);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    widths[name] = round(((hi - lo) / size) * 1000);
  }

  // Silhouettes (front-facing triangles) for dev previews
  const nrm = g.attributes.normal;
  const idx = g.index;
  const tri = (fn, sign) => {
    const parts = [];
    for (let i = 0; i < idx.count; i += 3) {
      const ia = idx.getX(i), ib = idx.getX(i + 1), ic = idx.getX(i + 2);
      const nx = (nrm.getX(ia) + nrm.getX(ib) + nrm.getX(ic)) / 3;
      if (nx * sign <= -0.05) continue;
      const pts = [ia, ib, ic].map((k) => fn({ x: pos.getX(k), y: pos.getY(k), z: pos.getZ(k) }).map((q) => q.toFixed(1)).join(","));
      parts.push(`M${pts[0]}L${pts[1]}L${pts[2]}Z`);
    }
    return parts.join("");
  };
  const out = {
    source: "public/models/hand-hq.glb (MakeHuman/MPFB2 CC0 female hand, built by scripts/hand-real)",
    frame,
    widths,
    palm: proj(toPalm),
    back: proj(toBack),
  };
  fs.writeFileSync("src/lib/mehndi/hand-landmarks.json", JSON.stringify(out, null, 1));
  fs.mkdirSync("scripts/out", { recursive: true });
  fs.writeFileSync("scripts/out/silhouette-palm.path.txt", tri(toPalm, -1));
  fs.writeFileSync("scripts/out/silhouette-back.path.txt", tri(toBack, 1));
  console.log("frame", frame, "widths", widths);
}, (e) => console.error(e));
