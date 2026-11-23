"use client";

// Photo 3D hands from mehndi-3d-tryon as a standalone 3D model (public/tryon/hands.glb, built from the
// photo relief by scripts/tryon/build_model.py), textured with the original photo atlases (paste / stain).
// Loaded lazily (next/dynamic) only when the visitor switches to the "Photo 3D" viewer.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PHOTO_TONES, PhotoLook, PhotoPresetId, PhotoTone } from "@/lib/photo-tryon";

interface Manifest {
  geo: { geo: { x0: number; x1: number; y0: number; y1: number; d: number; w: number; h: number; hmax: number }; tex: { x0: number; x1: number; y0: number; y1: number } };
  presets: { id: string; stain: boolean }[];
  atlas: Record<string, string>;
  mask: string;
}

export interface PhotoSceneHandle {
  reset: () => void;
  zoom: (factor: number) => void;
}

interface Props {
  preset: PhotoPresetId;
  look: PhotoLook;
  tone: PhotoTone;
  onReady?: () => void;
  onError?: (e: Error) => void;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const PhotoHandScene = forwardRef<PhotoSceneHandle, Props>(function PhotoHandScene({ preset, look, tone, onReady, onError }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{
    setDesign: (preset: PhotoPresetId, look: PhotoLook) => void;
    setTone: (t: PhotoTone) => void;
    reset: () => void;
    zoom: (f: number) => void;
  } | null>(null);
  const latest = useRef({ preset, look, tone });
  latest.current = { preset, look, tone };

  useImperativeHandle(ref, () => ({ reset: () => api.current?.reset(), zoom: (f) => api.current?.zoom(f) }));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y;outline:none";
    el.appendChild(canvas);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (e) {
      onError?.(e as Error);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping; // keep the photographs' colours
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const scene = new THREE.Scene();
    // No backdrop: the hands float as a 3D model on the page’s own stage.
    const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, canvas);
    Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.7, zoomSpeed: 0.9, enablePan: false, minPolarAngle: 0, maxPolarAngle: Math.PI });
    controls.target.set(0, 0, 0.45);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    const hemi = new THREE.HemisphereLight(0xffffff, 0xf2d6d2, 0.62);
    hemi.position.set(0, 0, 1);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4ec, 1.35);
    key.position.set(-11, 8, 15);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -14, right: 14, top: 16, bottom: -14, near: 1, far: 60 });
    scene.add(key, key.target);

    const loadTex = (url: string, srgb = true) =>
      new Promise<THREE.Texture>((res, rej) =>
        new THREE.TextureLoader().load(
          url,
          (t) => {
            t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            t.anisotropy = aniso;
            res(t);
          },
          undefined,
          rej,
        ),
      );

    const atlasCache = new Map<string, Promise<THREE.Texture>>();
    let manifest: Manifest;
    let handMat: THREE.MeshStandardMaterial | null = null;
    let underMat: THREE.MeshStandardMaterial | null = null;
    let underBase: THREE.Color | null = null;
    const disposables: { dispose: () => void }[] = [];
    let fitDist = 30;
    let anim: { from: View; to: View; t0: number; dur: number } | null = null;
    type View = { theta: number; phi: number; dist: number };

    const fitDistance = () => {
      const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      return Math.max(9.3 / t, 6.6 / (t * camera.aspect));
    };
    const getView = (): View => {
      const o = camera.position.clone().sub(controls.target);
      const dist = o.length();
      return { theta: Math.atan2(o.x, -o.y), phi: Math.acos(clamp(o.z / dist, -1, 1)), dist };
    };
    const setView = (v: View) => {
      const sp = Math.sin(v.phi);
      camera.position.set(v.dist * sp * Math.sin(v.theta), -v.dist * sp * Math.cos(v.theta), 0.45 + v.dist * Math.cos(v.phi));
      camera.lookAt(controls.target);
    };
    const defaultView = (): View => ({ theta: 0, phi: 0.2, dist: fitDistance() });
    const animateTo = (to: View, dur = 1100) => (anim = { from: getView(), to, t0: performance.now(), dur });

    const atlasKey = (id: string, lk: PhotoLook) => (lk === "stain" && manifest.presets.find((p) => p.id === id)?.stain ? `${id}_stain` : id);
    const getAtlas = (k: string) => {
      if (!atlasCache.has(k)) atlasCache.set(k, loadTex(manifest.atlas[k]));
      return atlasCache.get(k)!;
    };
    let job = 0;
    const setDesign = async (id: PhotoPresetId, lk: PhotoLook) => {
      if (!handMat) return;
      const my = ++job;
      const tex = await getAtlas(atlasKey(id, lk));
      if (my !== job || disposed || !handMat) return;
      handMat.map = handMat.emissiveMap = tex;
      handMat.needsUpdate = true;
    };
    const setTone = (t: PhotoTone) => {
      if (!handMat) return;
      const m = PHOTO_TONES[t].mul;
      handMat.color.setRGB(m[0], m[1], m[2]);
      handMat.emissive.setRGB(m[0], m[1], m[2]);
      if (underMat && underBase) {
        underMat.color.setRGB(underBase.r * m[0], underBase.g * m[1], underBase.b * m[2]);
        underMat.emissive.copy(underMat.color).multiplyScalar(0.5);
      }
    };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      fitDist = fitDistance();
      controls.minDistance = fitDist * 0.3;
      controls.maxDistance = fitDist * 1.25;
    };
    const ro = new ResizeObserver(resize);

    (async () => {
      manifest = await (await fetch("/tryon/manifest.json")).json();
      // Standalone 3D model built from the photo relief (scripts/tryon/build_model.py): the front
      // surface carries the original photo atlases unchanged; underside + sides use plain skin colour.
      const [gltf, maskTex] = await Promise.all([new GLTFLoader().loadAsync("/tryon/hands.glb"), loadTex(manifest.mask, false)]);
      if (disposed) return;
      const model = gltf.scene;
      handMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.5,
        roughness: 0.62,
        metalness: 0,
        alphaMap: maskTex,
        alphaTest: 0.5,
        alphaToCoverage: true,
        envMapIntensity: 0.18,
      });
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        if (src.name === "photo") {
          m.material = handMat!;
        } else {
          underMat = new THREE.MeshStandardMaterial({ color: src.color.clone(), roughness: 0.62, metalness: 0, envMapIntensity: 0.18 });
          underBase = src.color.clone();
          underMat.emissive.copy(src.color).multiplyScalar(0.5);
          m.material = underMat;
          disposables.push(m.geometry);
        }
        src.dispose();
        m.castShadow = true;
        m.receiveShadow = true;
        if (m.material === handMat) disposables.push(m.geometry);
      });
      scene.add(model);
      disposables.push(handMat, maskTex, envTex, pmrem);
      if (underMat) disposables.push(underMat);

      setTone(latest.current.tone);
      await setDesign(latest.current.preset, latest.current.look);
      if (disposed) return;
      resize();
      ro.observe(el);
      const dv = defaultView();
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) setView(dv);
      else {
        setView({ theta: -0.55, phi: 0.85, dist: dv.dist * 1.12 });
        animateTo(dv, 2000);
      }
      controls.addEventListener("start", () => (anim = null));
      renderer.setAnimationLoop(() => {
        if (anim) {
          const k = ease(clamp((performance.now() - anim.t0) / anim.dur, 0, 1));
          setView({ theta: lerp(anim.from.theta, anim.to.theta, k), phi: lerp(anim.from.phi, anim.to.phi, k), dist: lerp(anim.from.dist, anim.to.dist, k) });
          if (k >= 1) anim = null;
        }
        controls.update();
        renderer.render(scene, camera);
      });
      api.current = {
        setDesign: (p, l) => void setDesign(p, l),
        setTone,
        reset: () => animateTo(defaultView()),
        zoom: (f) => {
          const v = getView();
          animateTo({ ...v, dist: clamp(v.dist * f, fitDist * 0.3, fitDist * 1.25) }, 500);
        },
      };
      onReady?.();
    })().catch((e) => !disposed && onError?.(e as Error));

    return () => {
      disposed = true;
      api.current = null;
      ro.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      atlasCache.forEach((p) => p.then((t) => t.dispose()).catch(() => {}));
      disposables.forEach((x) => x.dispose());
      renderer.dispose();
      canvas.remove();
    };
    // Build the scene once; design/tone changes go through api.current below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.setDesign(preset, look);
  }, [preset, look]);
  useEffect(() => {
    api.current?.setTone(tone);
  }, [tone]);

  return <div ref={host} className="absolute inset-0" />;
});

export default PhotoHandScene;
