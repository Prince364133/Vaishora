// Natural, relaxed pose for the sculpted hand, applied to the mesh at load time (the GLB has joint empties but no
// skin). Real hands in mehndi photographs rest with the fingers close together and a gentle curl that increases
// from the index to the little finger; the sculpted hand's fingers are straighter and spread.
//
// Method: every vertex is assigned to the nearest finger chain (proximal → intermediate → distal → tip). Each joint
// rotates the part of the finger beyond it about the joint, blended over a short zone (smoothstep) so the skin bends
// instead of breaking. Joints are applied distal-first with rest-pose pivots, which composes like a bone chain.
// The original positions/normals are kept as `restPosition` / `restNormal`: the mehndi shader projects the artwork
// and photos from them, so the henna stays glued to the skin in any pose.

import * as THREE from "three";

export interface FingerPose {
  /** Rotation towards the middle finger at the knuckle (degrees, positive = closer). */
  spread: number;
  /** Curl towards the palm at knuckle, middle and end joints (degrees). */
  curl: [number, number, number];
  /** Sideways slide towards the middle finger (metres), blended in from the knuckle: closes the gaps at the base. */
  shift?: number;
  /** 0..1: undo this share of the model's built-in joint bends first (1 = straight finger), then apply `curl`. */
  straighten?: number;
}
export type HandPose = Partial<Record<"thumb" | "index" | "middle" | "ring" | "pinky", FingerPose>>;

/**
 * The bare-hands reference photo (mehndi-3d-tryon): open, flat palms, the four fingers straight and resting side by
 * side with no gaps, thumbs relaxed outwards. The model's own fingers are bent ~7° / 15° / 9° at the three joints
 * (they looked folded at an angle), so most of that is straightened out first. Angles come from the model's finger axes in the palm
 * plane: index −2.7°, middle +5.9°, ring +11.8°, pinky +10.9° (index spreads 8.6° away from the middle finger).
 */
export const REFERENCE_POSE: HandPose = {
  thumb: { spread: 2, curl: [0, 0, 0], straighten: 0.5 },
  index: { spread: 8, curl: [1, 2, 1], shift: 0.0055, straighten: 0.9 },
  middle: { spread: 0, curl: [1, 2, 1], straighten: 0.9 },
  ring: { spread: 6, curl: [1, 3, 2], shift: 0.0022, straighten: 0.9 },
  pinky: { spread: 7, curl: [2, 4, 3], shift: 0.0042, straighten: 0.85 },
};

/** Relaxed pose: fingers closed up, soft curl cascade, thumb relaxed towards the palm. */

export const RELAXED_POSE: HandPose = {
  thumb: { spread: 8, curl: [5, 8, 7] },
  index: { spread: 5, curl: [5, 8, 6] },
  middle: { spread: 0, curl: [6, 10, 7] },
  ring: { spread: 5, curl: [8, 12, 8] },
  pinky: { spread: 9, curl: [11, 14, 10] },
};

const CHAINS = {
  thumb: ["thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
  index: ["index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip"],
  middle: ["middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip"],
  ring: ["ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip"],
  pinky: ["pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"],
} as const;
type Finger = keyof typeof CHAINS;

const PALM_NORMAL = new THREE.Vector3(-1, 0, 0); // model space: palm faces −X, fingers −Y
const BLEND = 0.0065; // half-width of the bending zone at a joint (m)

function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** Joint positions (model space) from the GLB's WebXR-named empties. */
export function readJoints(scene: THREE.Object3D): Record<string, THREE.Vector3> {
  const out: Record<string, THREE.Vector3> = {};
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh && o.name) out[o.name] = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  });
  return out;
}

/** Returns a posed copy of `geo` with `restPosition` / `restNormal` holding the original surface. */
export function poseHand(geo: THREE.BufferGeometry, joints: Record<string, THREE.Vector3>, pose: HandPose): THREE.BufferGeometry {
  const g = geo.clone();
  // de-quantize: positions/normals become plain float32 so they can be rewritten
  const srcP = geo.getAttribute("position");
  const srcN = geo.getAttribute("normal");
  const n = srcP.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos.set([srcP.getX(i), srcP.getY(i), srcP.getZ(i)], i * 3);
    nor.set([srcN.getX(i), srcN.getY(i), srcN.getZ(i)], i * 3);
  }
  g.setAttribute("restPosition", new THREE.BufferAttribute(pos.slice(), 3));
  g.setAttribute("restNormal", new THREE.BufferAttribute(nor.slice(), 3));

  const fingers = (Object.keys(CHAINS) as Finger[]).filter((f) => pose[f] && CHAINS[f].every((j) => joints[j]));
  if (!fingers.length) {
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    return g;
  }
  const chain = (f: Finger) => CHAINS[f].map((j) => joints[j]);
  const middleTip = joints["middle-finger-tip"];

  // Per finger: list of joint rotations (pivot, direction of the bone beyond it, quaternion), distal first.
  const rigs = new Map<Finger, { pivot: THREE.Vector3; dir: THREE.Vector3; q: THREE.Quaternion }[]>();
  const shifts = new Map<Finger, { pivot: THREE.Vector3; dir: THREE.Vector3; t: THREE.Vector3 }>();
  const midBase = joints["middle-finger-phalanx-proximal"];
  for (const f of fingers) {
    const pts = chain(f);
    const p = pose[f]!;
    const rots: { pivot: THREE.Vector3; dir: THREE.Vector3; q: THREE.Quaternion }[] = [];
    const meta = joints[f === "thumb" ? "thumb-metacarpal" : `${f}-finger-metacarpal`];
    for (let k = 0; k < pts.length - 1; k++) {
      const dir = pts[k + 1].clone().sub(pts[k]).normalize();
      // curl axis: perpendicular to the bone and the palm normal; sign chosen so the tip moves towards the palm
      const axis = new THREE.Vector3().crossVectors(dir, PALM_NORMAL).normalize();
      const test = dir.clone().applyAxisAngle(axis, 0.1);
      if (test.dot(PALM_NORMAL) < dir.dot(PALM_NORMAL)) axis.negate();
      // the model's own bend at this joint (positive = towards the palm), relative to the previous bone
      let bend = 0;
      const prevFrom = k === 0 ? meta : pts[k - 1];
      if (p.straighten && prevFrom) {
        const prev = pts[k].clone().sub(prevFrom).normalize();
        bend = Math.atan2(new THREE.Vector3().crossVectors(prev, dir).dot(axis), prev.dot(dir));
      }
      const angle = THREE.MathUtils.degToRad(p.curl[k] ?? 0) - bend * (p.straighten ?? 0);
      const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      if (k === 0 && p.spread && f !== "middle") {
        // spread: about the palm normal, towards the middle finger tip (thumb: towards the index side of the palm)
        const sAxis = PALM_NORMAL.clone();
        const tip = pts[pts.length - 1].clone().sub(pts[0]);
        const target = (f === "thumb" ? joints["index-finger-phalanx-proximal"] : middleTip).clone().sub(pts[0]);
        const plus = tip.clone().applyAxisAngle(sAxis, 0.05).angleTo(target);
        if (plus > tip.angleTo(target)) sAxis.negate();
        q.premultiply(new THREE.Quaternion().setFromAxisAngle(sAxis, THREE.MathUtils.degToRad(p.spread)));
      }
      rots.push({ pivot: pts[k].clone(), dir, q });
    }
    rigs.set(f, rots.reverse());
    if (p.shift && f !== "middle" && f !== "thumb" && midBase) {
      // in the palm plane (model YZ), perpendicular to the finger, towards the middle finger
      const d0 = pts[1].clone().sub(pts[0]).setX(0).normalize();
      const lat = new THREE.Vector3().crossVectors(d0, PALM_NORMAL).normalize();
      if (lat.dot(midBase.clone().sub(pts[0])) < 0) lat.negate();
      shifts.set(f, { pivot: pts[0].clone(), dir: d0, t: lat.multiplyScalar(p.shift) });
    }
  }

  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const qi = new THREE.Quaternion();
  const ident = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    v.fromArray(pos, i * 3);
    // nearest finger chain
    let best: Finger | null = null;
    let bestD = Infinity;
    for (const f of fingers) {
      const pts = chain(f);
      for (let k = 0; k < pts.length - 1; k++) {
        const d = segDist(v, pts[k], pts[k + 1]);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
    }
    if (!best || bestD > 0.03) continue;
    nv.fromArray(nor, i * 3);
    let moved = false;
    for (const r of rigs.get(best)!) {
      const s = v.clone().sub(r.pivot).dot(r.dir);
      const w = THREE.MathUtils.smoothstep(s, -BLEND, BLEND);
      if (w <= 0) continue;
      qi.slerpQuaternions(ident, r.q, w);
      v.sub(r.pivot).applyQuaternion(qi).add(r.pivot);
      nv.applyQuaternion(qi);
      moved = true;
    }
    const sh = shifts.get(best);
    if (sh) {
      // slide blends in over the web of the hand (from 1.5 cm before the knuckle to the knuckle)
      const w = THREE.MathUtils.smoothstep(v.clone().sub(sh.pivot).dot(sh.dir), -0.015, 0.002);
      if (w > 0) {
        v.addScaledVector(sh.t, w);
        moved = true;
      }
    }
    if (moved) {
      v.toArray(pos, i * 3);
      nv.normalize().toArray(nor, i * 3);
    }
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Rest attributes for an unposed geometry (same surface), so every mesh using the mehndi shader has them. */
export function ensureRestAttributes(geo: THREE.BufferGeometry) {
  if (geo.getAttribute("restPosition")) return;
  geo.setAttribute("restPosition", geo.getAttribute("position"));
  geo.setAttribute("restNormal", geo.getAttribute("normal"));
}
