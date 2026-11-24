"use client";
/* eslint-disable react-hooks/immutability -- React Three Fiber renders imperatively: three.js objects
   (uniforms, spherical coordinates, cameras) are intentionally mutated inside useFrame, which runs
   outside React rendering. See .claude/skills/threejs-react-three-fiber ("mutate objects through refs"). */

// The WebGL part of the hand viewer. Loaded only on the client via next/dynamic.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, useGLTF, useTexture } from "@react-three/drei";
import landmarks from "@/lib/mehndi/hand-landmarks.json";
import { forwardRef, Suspense, use, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ensureRestAttributes } from "./handPose";
import { createMehndiMaterial, EMPTY_TEXTURE, loadArtTexture, loadPhotoTexture } from "./mehndiMaterial";
import { PHOTO_TONES, PhotoTone } from "@/lib/photo-tryon";

// Realistic female hand built from CC0 MakeHuman assets (scripts/hand-real, docs/HAND_REALISM.md).
export const HAND_HQ_URL = "/models/hand-hq.glb";
export const HAND_LQ_URL = "/models/hand-lq.glb";
// Tileable skin micro normal (scripts/hand-real/make_env_micro.py).
const MICRO_URL = "/models/skin-micro-normal.jpg";
// Skin maps. Primary: KTX2 / Basis Universal (scripts/hand-real/make_ktx2.py) — GPU-compressed, so both tiers can use
// 2K (a 2K ETC1S map is ~2–4 MB of GPU memory instead of 16 MB RGBA). The Basis transcoder is served locally from
// /basis/ (copied from three/examples/jsm/libs/basis; no CDN). Fallback: the JPEGs, if KTX2 fails for any reason.
const SKIN_MAPS_KTX2 = ["/models/hand-albedo-2k.ktx2", "/models/hand-normal-2k.ktx2", "/models/hand-detail-1k.ktx2"] as const;
const SKIN_MAPS = {
  high: ["/models/hand-albedo-2k.jpg", "/models/hand-normal-2k.jpg", "/models/hand-detail-1k.jpg"],
  low: ["/models/hand-albedo-1k.jpg", "/models/hand-normal-1k.jpg", "/models/hand-detail-1k.jpg"],
} as const;
const BASIS_PATH = "/basis/";

const skinMapCache = new Map<string, Promise<THREE.Texture[]>>();

/** Load the three skin maps (albedo, normal, detail): KTX2 first, JPEG fallback. Cached per renderer + tier. */
function loadSkinMaps(gl: THREE.WebGLRenderer, quality: "high" | "low"): Promise<THREE.Texture[]> {
  const key = `${quality}:${gl.domElement.dataset.engine ?? ""}:${(gl as unknown as { id?: number }).id ?? 0}`;
  const hit = skinMapCache.get(key);
  if (hit) return hit;
  const jpg = () => Promise.all(SKIN_MAPS[quality].map((u) => new THREE.TextureLoader().loadAsync(u)));
  const p = (async () => {
    const loader = new KTX2Loader().setTranscoderPath(BASIS_PATH);
    try {
      loader.detectSupport(gl);
      return await Promise.all(SKIN_MAPS_KTX2.map((u) => loader.loadAsync(u)));
    } catch (e) {
      console.warn("KTX2 skin maps unavailable, using JPEG", e);
      return jpg();
    } finally {
      loader.dispose();
    }
  })();
  skinMapCache.set(key, p);
  return p;
}

export type HandView = "palm" | "back";

export interface HandSceneHandle {
  setView: (view: HandView) => void;
  reset: () => void;
  zoom: (factor: number) => void;
}

interface Props {
  palmArt: string | null;
  backArt: string | null;
  /** Optional photo albedo per side ("palm_photo" / "back_photo" assets): real skin + henna, used instead of the mask. */
  palmPhoto?: string | null;
  backPhoto?: string | null;
  quality: "high" | "low";
  /** Skin tone (shared with the Photo 3D viewer). */
  tone?: PhotoTone;
  onReady?: () => void;
  onError?: (e: Error) => void;
  onViewChange?: (view: HandView) => void;
  interactive?: boolean;
}

const DEFAULT_DISTANCE = 0.55;
/** Skin look matched to Photo 3D (no tone mapping, like the photo viewer). */
export const PHOTO_MATCH_SKIN = {
  even: 0.7,
  normal: 0.3,
  grade: [1.46, 1.5, 1.27] as [number, number, number],
  // stain colours relative to skin, measured on the Photo 3D dried stain (mid lines / dense fills)
  hennaThin: [0.69, 0.3, 0.2] as [number, number, number],
  hennaDeep: [0.47, 0.14, 0.1] as [number, number, number],
};
const MIN_DISTANCE = 0.28;
// The forearm runs ~19 cm past the wrist; at this distance and the polar limits below its closed end stays out of frame.
const MAX_DISTANCE = 0.78;

export function useHandAssets(quality: "high" | "low") {
  const gltf = useGLTF(quality === "high" ? HAND_HQ_URL : HAND_LQ_URL, false);
  const gl = useThree((s) => s.gl);
  const [albedo, normal, detail] = use(useMemo(() => loadSkinMaps(gl, quality), [gl, quality]));
  const micro = useTexture(MICRO_URL);
  return useMemo(() => {
    let mesh: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
    });
    if (!mesh) throw new Error("Hand mesh not found in model");
    const geo = (mesh as THREE.Mesh).geometry;
    geo.computeBoundingBox();
    ensureRestAttributes(geo);
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    micro.wrapS = micro.wrapT = THREE.RepeatWrapping;
    micro.colorSpace = THREE.NoColorSpace;
    for (const t of [albedo, normal, detail, micro]) {
      t.flipY = false; // glTF UV convention
      t.anisotropy = aniso;
      t.needsUpdate = true;
    }
    albedo.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    detail.colorSpace = THREE.NoColorSpace;
    return { geo, scene: gltf.scene, maps: { albedo, normal, detail, micro } };
  }, [gltf, albedo, normal, detail, micro, gl]);
}

function Hand({ palmArt, backArt, palmPhoto = null, backPhoto = null, quality, tone = "natural", onReady, onError }: Props) {
  const { geo, maps } = useHandAssets(quality);
  const { material, uniforms } = useMemo(() => createMehndiMaterial(maps), [maps]);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const fade = useRef({ active: false, t: 0 });
  const readyRef = useRef(false);

  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    const m = PHOTO_TONES[tone].mul;
    uniforms.uTone.value.setRGB(m[0], m[1], m[2]);
    invalidate();
  }, [tone, uniforms, invalidate]);

  // Same skin as the Photo 3D viewer: one even warm hue without albedo patches, a smoother surface, and a colour
  // grade measured against the photo skin (scripts/out/shot-sculpted.mjs vs shot-photo3d.mjs).
  useEffect(() => {
    uniforms.uEven.value = PHOTO_MATCH_SKIN.even;
    uniforms.uGrade.value.setRGB(...PHOTO_MATCH_SKIN.grade);
    uniforms.uHennaThin.value.setRGB(...PHOTO_MATCH_SKIN.hennaThin);
    uniforms.uHennaDeep.value.setRGB(...PHOTO_MATCH_SKIN.hennaDeep);
    uniforms.uPhotoHennaRemap.value = 1;
    material.normalScale.set(PHOTO_MATCH_SKIN.normal, PHOTO_MATCH_SKIN.normal);
    invalidate();
  }, [uniforms, material, invalidate]);
  // Skin maps belong to this quality tier only; free GPU memory when the tier/scene goes away.
  useEffect(() => () => Object.values(maps).forEach((t) => t.dispose()), [maps]);

  useEffect(() => {
    let cancelled = false;
    const size = quality === "high" ? 2048 : 1024;
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    const photoAniso = Math.min(16, gl.capabilities.getMaxAnisotropy());
    // A side with a photo uses the photo instead of the procedural mask.
    Promise.all([
      palmArt && !palmPhoto ? loadArtTexture(palmArt, size, aniso) : Promise.resolve(EMPTY_TEXTURE),
      backArt && !backPhoto ? loadArtTexture(backArt, size, aniso) : Promise.resolve(EMPTY_TEXTURE),
      palmPhoto ? loadPhotoTexture(palmPhoto, photoAniso) : Promise.resolve(EMPTY_TEXTURE),
      backPhoto ? loadPhotoTexture(backPhoto, photoAniso) : Promise.resolve(EMPTY_TEXTURE),
    ])
      .then(([palm, back, pPalm, pBack]) => {
        if (cancelled) return;
        if (!readyRef.current) {
          uniforms.uPalmA.value = palm;
          uniforms.uBackA.value = back;
          uniforms.uPhotoPalmA.value = pPalm;
          uniforms.uPhotoBackA.value = pBack;
          uniforms.uMix.value = 0;
          readyRef.current = true;
          invalidate();
          onReady?.();
          return;
        }
        // Crossfade from the current design (A) to the new one (B).
        if (fade.current.active) {
          uniforms.uPalmA.value = uniforms.uMix.value > 0.5 ? uniforms.uPalmB.value : uniforms.uPalmA.value;
          uniforms.uBackA.value = uniforms.uMix.value > 0.5 ? uniforms.uBackB.value : uniforms.uBackA.value;
          uniforms.uPhotoPalmA.value = uniforms.uMix.value > 0.5 ? uniforms.uPhotoPalmB.value : uniforms.uPhotoPalmA.value;
          uniforms.uPhotoBackA.value = uniforms.uMix.value > 0.5 ? uniforms.uPhotoBackB.value : uniforms.uPhotoBackA.value;
        }
        uniforms.uPalmB.value = palm;
        uniforms.uBackB.value = back;
        uniforms.uPhotoPalmB.value = pPalm;
        uniforms.uPhotoBackB.value = pBack;
        uniforms.uMix.value = 0;
        fade.current = { active: true, t: 0 };
        invalidate();
      })
      .catch((e: Error) => !cancelled && onError?.(e));
    return () => {
      cancelled = true;
    };
  }, [palmArt, backArt, palmPhoto, backPhoto, quality, gl, uniforms, invalidate, onReady, onError]);

  useFrame((_, delta) => {
    if (!fade.current.active) return;
    fade.current.t = Math.min(1, fade.current.t + delta / 0.45);
    const t = fade.current.t;
    uniforms.uMix.value = t * t * (3 - 2 * t);
    if (t >= 1) {
      uniforms.uPalmA.value = uniforms.uPalmB.value;
      uniforms.uBackA.value = uniforms.uBackB.value;
      uniforms.uPhotoPalmA.value = uniforms.uPhotoPalmB.value;
      uniforms.uPhotoBackA.value = uniforms.uPhotoBackB.value;
      uniforms.uMix.value = 0;
      fade.current.active = false;
    }
    invalidate();
  });

  // Model space: fingers point -Y, palm faces -X. Turn it so fingers point up and
  // the palm faces the camera (+Z), then centre it.
  // The last ~5 cm of forearm dissolve into the stage, so centre on the visible part (fingertips → fade start).
  const center = useMemo(() => {
    const bb = geo.boundingBox!;
    const c = bb.getCenter(new THREE.Vector3());
    // centre on the hand region of the projection frame (fingertips → 8.5 cm below the wrist), not the long forearm
    c.y = (landmarks.frame.minY + landmarks.frame.maxY) / 2 - 0.004;
    return c;
  }, [geo]);

  return (
    <group rotation={[0, -Math.PI / 2, Math.PI]}>
      <mesh geometry={geo} material={material} position={[-center.x, -center.y, -center.z]} />
    </group>
  );
}

const CameraRig = forwardRef<HandSceneHandle, { onViewChange?: (v: HandView) => void; interactive: boolean }>(
  function CameraRig({ onViewChange, interactive }, ref) {
    const controls = useRef<OrbitControlsImpl>(null);
    const camera = useThree((s) => s.camera);
    const invalidate = useThree((s) => s.invalidate);
    const anim = useRef<{ az: number; polar: number; dist: number; active: boolean } | null>(null);
    const lastView = useRef<HandView>("palm");

    const spherical = useMemo(() => new THREE.Spherical(), []);
    const tmp = useMemo(() => new THREE.Vector3(), []);

    useImperativeHandle(ref, () => ({
      setView(view) {
        const c = controls.current;
        if (!c) return;
        const cur = c.getAzimuthalAngle();
        let target = view === "palm" ? 0 : Math.PI;
        // take the shortest way round
        while (target - cur > Math.PI) target -= Math.PI * 2;
        while (target - cur < -Math.PI) target += Math.PI * 2;
        anim.current = { az: target, polar: Math.PI / 2, dist: c.getDistance(), active: true };
        invalidate();
      },
      reset() {
        anim.current = { az: 0, polar: Math.PI / 2, dist: DEFAULT_DISTANCE, active: true };
        invalidate();
      },
      zoom(factor) {
        const c = controls.current;
        if (!c) return;
        const dist = THREE.MathUtils.clamp(c.getDistance() * factor, MIN_DISTANCE, MAX_DISTANCE);
        anim.current = { az: c.getAzimuthalAngle(), polar: c.getPolarAngle(), dist, active: true };
        invalidate();
      },
    }));

    // Single introductory turn: from a three-quarter view to the palm.
    useEffect(() => {
      spherical.set(DEFAULT_DISTANCE, Math.PI / 2 - 0.12, -0.9);
      camera.position.setFromSpherical(spherical);
      camera.lookAt(0, 0, 0);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        camera.position.set(0, 0, DEFAULT_DISTANCE);
      } else {
        anim.current = { az: 0, polar: Math.PI / 2, dist: DEFAULT_DISTANCE, active: true };
      }
      invalidate();
    }, [camera, spherical, invalidate]);

    useFrame((_, delta) => {
      const a = anim.current;
      const c = controls.current;
      if (!a?.active || !c) return;
      tmp.copy(camera.position).sub(c.target);
      spherical.setFromVector3(tmp);
      const k = 1 - Math.exp(-delta * 6);
      spherical.theta += (a.az - spherical.theta) * k;
      spherical.phi += (a.polar - spherical.phi) * k;
      spherical.radius += (a.dist - spherical.radius) * k;
      camera.position.setFromSpherical(spherical).add(c.target);
      camera.lookAt(c.target);
      if (Math.abs(a.az - spherical.theta) < 0.002 && Math.abs(a.polar - spherical.phi) < 0.002 && Math.abs(a.dist - spherical.radius) < 0.001) {
        a.active = false;
      }
      c.update();
      invalidate();
    });

    const reportView = () => {
      const c = controls.current;
      if (!c) return;
      const az = c.getAzimuthalAngle();
      const view: HandView = Math.cos(az) >= 0 ? "palm" : "back";
      if (view !== lastView.current) {
        lastView.current = view;
        onViewChange?.(view);
      }
    };

    return (
      <OrbitControls
        ref={controls}
        makeDefault
        enabled={interactive}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.7}
        zoomSpeed={0.6}
        minDistance={MIN_DISTANCE}
        maxDistance={MAX_DISTANCE}
        minPolarAngle={Math.PI * 0.3}
        maxPolarAngle={Math.PI * 0.62}
        onStart={() => {
          if (anim.current) anim.current.active = false;
        }}
        onChange={reportView}
      />
    );
  },
);

/** Flattering beauty lighting, symmetric so palm and back are both well lit: a soft warm key for each side,
 *  a warm low fill, gentle ambient, and a baked Lightformer environment (no HDR download). */
export function StudioLights({ shadows = false }: { shadows?: boolean }) {
  return (
    <>
      <ambientLight intensity={0.42} color="#fff0e6" />
      <directionalLight
        position={[0.55, 0.8, 1]}
        intensity={1.35}
        color="#fff3ea"
        castShadow={shadows}
        // soft contact shadows between fingers, under the bangles and from the thumb onto the palm
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.0015}
        shadow-radius={5}
        shadow-camera-left={-0.25}
        shadow-camera-right={0.25}
        shadow-camera-top={0.25}
        shadow-camera-bottom={-0.25}
        shadow-camera-near={0.3}
        shadow-camera-far={3}
      />
      <directionalLight position={[-0.55, 0.8, -1]} intensity={1.35} color="#fff3ea" />
      <directionalLight position={[-0.9, -0.4, 0.2]} intensity={0.45} color="#ffd8c4" />
      <Suspense fallback={null}>
        <Environment resolution={128} frames={1}>
          <Lightformer form="rect" intensity={1.6} color="#fff6f0" position={[0, 2, 3]} scale={[4, 2, 1]} />
          <Lightformer form="rect" intensity={1.6} color="#fff6f0" position={[0, 2, -3]} scale={[4, 2, 1]} />
          <Lightformer form="rect" intensity={0.8} color="#f8e8ec" position={[-3, 0, 1]} scale={[2, 4, 1]} />
          <Lightformer form="rect" intensity={0.7} color="#d4af7c" position={[3, -1, -2]} scale={[2, 3, 1]} />
          <Lightformer form="circle" intensity={0.5} color="#ffffff" position={[0, -3, 0]} scale={2} />
        </Environment>
      </Suspense>
    </>
  );
}

const HandScene = forwardRef<HandSceneHandle, Props>(function HandScene(props, ref) {
  const { quality, interactive = true } = props;
  return (
    <Canvas
      frameloop="demand"
      dpr={quality === "high" ? [1, 2] : [1, 1.5]}
      camera={{ position: [0, 0, DEFAULT_DISTANCE], fov: 28, near: 0.01, far: 10 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NoToneMapping; // like Photo 3D: true photo colours, no filmic desaturation
      }}
      aria-hidden
    >
      <StudioLights />
      <Suspense fallback={null}>
        <Hand {...props} />
      </Suspense>
      <CameraRig ref={ref} onViewChange={props.onViewChange} interactive={interactive} />
    </Canvas>
  );
});

export default HandScene;

