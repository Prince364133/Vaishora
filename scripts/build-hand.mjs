// Packs the Blender-built realistic hand (scripts/hand-real/build_hand.py) into compact web GLBs.
//
//   node scripts/build-hand.mjs [build_dir]        (default build_dir: scripts/out/hand-build)
//
// Input : <build_dir>/hand-hq.glb, <build_dir>/hand-lq.glb   (float POSITION/NORMAL/TEXCOORD_0 + joint empties)
// Output: public/models/hand-hq.glb, public/models/hand-lq.glb
//
// Packing (KHR_mesh_quantization, decoded natively by three.js GLTFLoader — no decoder download):
//   POSITION   float32 (kept exact: the mehndi shader projects artwork in bind-pose object space)
//   NORMAL     int8 normalized   (stride 4)
//   TEXCOORD_0 uint16 normalized
//   indices    uint16 / uint32
// Joint empties (named like WebXR hand joints) are kept as plain nodes for scripts/extract-landmarks.mjs.

import fs from "node:fs";
import path from "node:path";

const BUILD = process.argv[2] ?? "scripts/out/hand-build";
const OUT = "public/models";

function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString("utf8"));
  const binStart = 20 + jsonLen + 8;
  const bin = b.subarray(binStart, binStart + b.readUInt32LE(20 + jsonLen));
  const accessor = (i) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const Ctor = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
    const off = bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return new Ctor(bin.buffer.slice(off, off + a.count * comps * Ctor.BYTES_PER_ELEMENT));
  };
  const prim = json.meshes[0].primitives[0];
  return {
    position: accessor(prim.attributes.POSITION),
    normal: accessor(prim.attributes.NORMAL),
    uv: accessor(prim.attributes.TEXCOORD_0),
    index: accessor(prim.indices),
    joints: json.nodes.filter((n) => n.mesh === undefined).map((n) => ({ name: n.name, translation: n.translation ?? [0, 0, 0] })),
  };
}

function writeGlb(file, { position, normal, uv, index, joints }) {
  const n = position.length / 3;
  const nrm = new Int8Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) nrm[i * 4 + k] = Math.round(Math.max(-1, Math.min(1, normal[i * 3 + k])) * 127);
  }
  const tex = new Uint16Array(n * 2);
  for (let i = 0; i < n * 2; i++) tex[i] = Math.round(Math.max(0, Math.min(1, uv[i])) * 65535);
  const idx = n > 65535 ? Uint32Array.from(index) : Uint16Array.from(index);
  const pad = (x) => (x + 3) & ~3;
  const parts = [position, nrm, tex, idx];
  const offsets = [];
  let len = 0;
  for (const p of parts) {
    offsets.push(len);
    len += pad(p.byteLength);
  }
  const bin = Buffer.alloc(len);
  parts.forEach((p, i) => Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(bin, offsets[i]));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], position[i * 3 + k]);
      max[k] = Math.max(max[k], position[i * 3 + k]);
    }
  }
  const json = {
    asset: {
      version: "2.0",
      generator: "vaishora build-hand",
      copyright: "CC0 — built from MakeHuman/MPFB2 CC0 assets (see public/models/LICENSE.md)",
    },
    extensionsUsed: ["KHR_mesh_quantization"],
    extensionsRequired: ["KHR_mesh_quantization"],
    scene: 0,
    scenes: [{ nodes: [0, ...joints.map((_, i) => i + 1)] }],
    nodes: [{ mesh: 0, name: "hand" }, ...joints.map((j) => ({ name: j.name, translation: j.translation }))],
    meshes: [{ name: "hand", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3 }] }],
    buffers: [{ byteLength: len }],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: position.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offsets[1], byteLength: nrm.byteLength, byteStride: 4, target: 34962 },
      { buffer: 0, byteOffset: offsets[2], byteLength: tex.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offsets[3], byteLength: idx.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5120, normalized: true, count: n, type: "VEC3" },
      { bufferView: 2, componentType: 5123, normalized: true, count: n, type: "VEC2" },
      { bufferView: 3, componentType: n > 65535 ? 5125 : 5123, count: idx.length, type: "SCALAR" },
    ],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad(jsonBuf.length) - jsonBuf.length, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, jh, jsonBuf, bh, bin]));
  console.log(`${file}: ${n} vertices, ${idx.length / 3} triangles, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

for (const tier of ["hq", "lq"]) {
  writeGlb(path.join(OUT, `hand-${tier}.glb`), readGlb(path.join(BUILD, `hand-${tier}.glb`)));
}
