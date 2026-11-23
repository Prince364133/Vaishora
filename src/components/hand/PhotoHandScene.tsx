"use client";

// Port of mehndi-3d-tryon/index.html: photographed hands rebuilt as a relief mesh from a 16-bit
// height map (R<<8|G), textured with per-design photo atlases (paste / stain), with skin-tone tint.
// Loaded lazily (next/dynamic) only when the visitor switches to the "Photo 3D" viewer.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PHOTO_TONES, PhotoLook, PhotoPresetId, PhotoTone } from "@/lib/photo-tryon";

interface Manifest {
  geo: { geo: { x0: number; x1: number; y0: number; y1: number; d: number; w: number; h: number; hmax: number }; tex: { x0: number; x1: number; y0: number; y1: number } };
  bgFrame: { x0: number; x1: number; y0: number; y1: number };
  presets: { id: string; stain: boolean }[];
  atlas: Record<string, string>;
  hmap: string;
  mask: string;
  background: string;
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

const U = 0.01;
const CX = 768;
const CY = 960;
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
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
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
    scene.background = new THREE.Color("#4b1d3f");
    const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, canvas);
    Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.7, zoomSpeed: 0.9, enablePan: false, minPolarAngle: 0, maxPolarAngle: 0.9, minAzimuthAngle: -0.9, maxAzimuthAngle: 0.9 });
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
      const F = manifest.geo.geo;
      const T = manifest.geo.tex;
      const TW = T.x1 - T.x0;
      const TH = T.y1 - T.y0;

      // heights: 16-bit packed in R (high) and G (low)
      const blob = await (await fetch(manifest.hmap)).blob();
      let bmp: ImageBitmap;
      try {
        bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      } catch {
        bmp = await createImageBitmap(blob);
      }
      const c2 = document.createElement("canvas");
      c2.width = F.w;
      c2.height = F.h;
      const g = c2.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, F.w, F.h).data;
      const n = F.w * F.h;
      const h = new Float32Array(n);
      for (let i = 0; i < n; i++) h[i] = (((d[i * 4] << 8) | d[i * 4 + 1]) / 65535) * F.hmax;

      const pos = new Float32Array(n * 3);
      const uv = new Float32Array(n * 2);
      for (let j = 0; j < F.h; j++)
        for (let i = 0; i < F.w; i++) {
          const k = j * F.w + i;
          const px = F.x0 + (i + 0.5) * F.d;
          const py = F.y0 + (j + 0.5) * F.d;
          pos[k * 3] = (px - CX) * U;
          pos[k * 3 + 1] = -(py - CY) * U;
          pos[k * 3 + 2] = h[k] * U;
          uv[k * 2] = (px - T.x0) / TW;
          uv[k * 2 + 1] = 1 - (py - T.y0) / TH;
        }
      const idx: number[] = [];
      const on = (k: number) => h[k] > 0.15;
      for (let j = 0; j < F.h - 1; j++)
        for (let i = 0; i < F.w - 1; i++) {
          const a = j * F.w + i;
          const b = a + 1;
          const c = a + F.w;
          const dd = c + 1;
          if (on(a) || on(b) || on(c) || on(dd)) idx.push(a, c, b, b, c, dd);
        }
      const handGeo = new THREE.BufferGeometry();
      handGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      handGeo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      handGeo.setIndex(idx);
      handGeo.computeVertexNormals();
      handGeo.computeBoundingSphere();

      const [bgTex, maskTex] = await Promise.all([loadTex(manifest.background), loadTex(manifest.mask, false)]);
      if (disposed) return;
      const B = manifest.bgFrame;
      const bgGeo = new THREE.PlaneGeometry((B.x1 - B.x0) * U, (B.y1 - B.y0) * U);
      bgGeo.translate(((B.x0 + B.x1) / 2 - CX) * U, -((B.y0 + B.y1) / 2 - CY) * U, -0.006);
      const bgMat = new THREE.MeshBasicMaterial({ map: bgTex });
      scene.add(new THREE.Mesh(bgGeo, bgMat));
      const shadowMat = new THREE.ShadowMaterial({ color: 0x4a1a22, opacity: 0.2 });
      const catcher = new THREE.Mesh(bgGeo, shadowMat);
      catcher.position.z = 0.002;
      catcher.receiveShadow = true;
      scene.add(catcher);

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
      const hands = new THREE.Mesh(handGeo, handMat);
      hands.castShadow = true;
      hands.receiveShadow = true;
      scene.add(hands);
      disposables.push(handGeo, bgGeo, bgMat, shadowMat, handMat, bgTex, maskTex, envTex, pmrem);

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
