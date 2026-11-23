"use client";

// "Photo 3D" — the mehndi-3d-tryon viewer (mehndi-3d-tryon/pipeline/templates/site_template.html), ported as is:
// one mesh for both hands built from the bare-hands photo's own height map (public/tryon/hmap.png, stage 4), the
// exact photo outline as alpha (mask.png), each design photo (paste / stain atlas) as colour and as a self-lit layer
// (~50/50) so the straight-on view is the photograph, the photo's own silk-and-petals backdrop as a fixed image
// (only the hands turn) with a soft shadow catcher, and orbit limits that keep the view on the palm side (±52°) so the photo never breaks apart.
// Loaded lazily (next/dynamic) when the visitor picks the "Photo 3D" viewer.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PHOTO_TONES, PhotoLook, PhotoPresetId, PhotoTone } from "@/lib/photo-tryon";
import { backdropRect } from "./PhotoBackdrop";

interface Frame { x0: number; x1: number; y0: number; y1: number }
interface Manifest {
  geo: { geo: Frame & { d: number; w: number; h: number; hmax: number }; tex: Frame };
  bgFrame: Frame;
  presets: { id: string; stain: boolean }[];
  atlas: Record<string, string>;
  hmap: string;
  mask: string;
  background: string;
}

export interface PhotoSceneHandle {
  reset: () => void;
  zoom: (factor: number) => void;
  showcase: (on: boolean) => void;
  download: (name: string) => void;
}

interface Props {
  preset: PhotoPresetId;
  look: PhotoLook;
  tone: PhotoTone;
  /** Gentle automatic sway (the original "Showcase" button). */
  showcase?: boolean;
  onShowcaseEnd?: () => void;
  /** Pixels at the bottom covered by floating controls: the hands are framed in the area above them. */
  insetBottom?: number;
  onReady?: () => void;
  onError?: (e: Error) => void;
}

const U = 0.01, CX = 768, CY = 960;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
type View = { theta: number; phi: number; dist: number; tx: number; ty: number };

const PhotoHandScene = forwardRef<PhotoSceneHandle, Props>(function PhotoHandScene(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const api = useRef<{
    setDesign: (p: PhotoPresetId, l: PhotoLook) => void;
    setTone: (t: PhotoTone) => void;
    handle: PhotoSceneHandle;
  } | null>(null);

  useImperativeHandle(ref, () => ({
    reset: () => api.current?.handle.reset(),
    zoom: (f) => api.current?.handle.zoom(f),
    showcase: (on) => api.current?.handle.showcase(on),
    download: (n) => api.current?.handle.download(n),
  }));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none";
    el.appendChild(canvas);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    } catch (e) {
      latest.current.onError?.(e as Error);
      canvas.remove();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping; // keep the photographs' true colours
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const scene = new THREE.Scene(); // transparent: the photo backdrop is a fixed image behind the canvas
    const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, canvas);
    Object.assign(controls, {
      enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.7, zoomSpeed: 0.9, panSpeed: 0.7, screenSpacePanning: true,
      minPolarAngle: 0, maxPolarAngle: 0.9, minAzimuthAngle: -0.9, maxAzimuthAngle: 0.9,
    });
    controls.target.set(0, 0, 0.45);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    // three ≥ r163 scales scene.environment by scene.environmentIntensity (the original, on r160, set the same
    // 0.18 through material.envMapIntensity, which no longer applies to scene.environment).
    scene.environmentIntensity = 0.18;
    const hemi = new THREE.HemisphereLight(0xffffff, 0xf2d6d2, 0.62);
    hemi.position.set(0, 0, 1);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4ec, 1.35);
    key.position.set(-11, 8, 15);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -14, right: 14, top: 16, bottom: -14, near: 1, far: 60 });
    scene.add(key, key.target);

    const loadTex = (url: string, srgb = true) =>
      new Promise<THREE.Texture>((res, rej) =>
        new THREE.TextureLoader().load(url, (t) => {
          t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.anisotropy = ANISO;
          res(t);
        }, undefined, rej),
      );

    let man: Manifest;
    const bgImg = new Image();
    const bgRect = backdropRect; // same placement as the 3D model viewer's backdrop
    let bgPlace = () => {};
    let handMat: THREE.MeshStandardMaterial | null = null;
    const atlasCache = new Map<string, Promise<THREE.Texture>>();
    const disposables: { dispose: () => void }[] = [envTex, pmrem];
    const assetKey = (id: string, look: PhotoLook) => (look === "stain" && man.presets.find((p) => p.id === id)?.stain ? `${id}_stain` : id);
    const getAtlas = (k: string) => {
      if (!atlasCache.has(k)) atlasCache.set(k, loadTex(man.atlas[k]).then((t) => { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; }));
      return atlasCache.get(k)!;
    };

    async function loadHeights(F: Manifest["geo"]["geo"]) {
      const blob = await (await fetch(man.hmap)).blob();
      let bmp: ImageBitmap;
      try {
        bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      } catch {
        bmp = await createImageBitmap(blob);
      }
      const c = document.createElement("canvas");
      c.width = F.w;
      c.height = F.h;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, F.w, F.h).data;
      const h = new Float32Array(F.w * F.h);
      for (let i = 0; i < h.length; i++) h[i] = (((d[i * 4] << 8) | d[i * 4 + 1]) / 65535) * F.hmax;
      return h;
    }

    function buildHandGeometry(h: Float32Array, F: Manifest["geo"]["geo"], T: Frame) {
      const TW = T.x1 - T.x0, TH = T.y1 - T.y0;
      const w = F.w, hh = F.h, n = w * hh;
      const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      for (let j = 0; j < hh; j++)
        for (let i = 0; i < w; i++) {
          const k = j * w + i, px = F.x0 + (i + 0.5) * F.d, py = F.y0 + (j + 0.5) * F.d;
          pos[k * 3] = (px - CX) * U;
          pos[k * 3 + 1] = -(py - CY) * U;
          pos[k * 3 + 2] = h[k] * U;
          uv[k * 2] = (px - T.x0) / TW;
          uv[k * 2 + 1] = 1 - (py - T.y0) / TH;
        }
      const idx: number[] = [];
      const on = (k: number) => h[k] > 0.15;
      for (let j = 0; j < hh - 1; j++)
        for (let i = 0; i < w - 1; i++) {
          const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
          if (on(a) || on(b) || on(c) || on(d)) idx.push(a, c, b, b, c, d);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      return geo;
    }

    // ---- camera helpers (same as the original)
    // framing area = canvas minus the floating toolbar strip (the backdrop still fills the whole frame)
    let hRatio = 1;
    const fitDistance = () => {
      const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      return Math.max((9.3 / t) * hRatio, 6.6 / (t * camera.aspect));
    };
    const defaultView = (): View => ({ theta: 0, phi: 0.2, dist: fitDistance(), tx: 0, ty: 0 });
    const getView = (): View => {
      const o = camera.position.clone().sub(controls.target);
      const dist = o.length();
      return { theta: Math.atan2(o.x, -o.y), phi: Math.acos(clamp(o.z / dist, -1, 1)), dist, tx: controls.target.x, ty: controls.target.y };
    };
    const setView = (v: View) => {
      controls.target.set(v.tx, v.ty, 0.45);
      const sp = Math.sin(v.phi);
      camera.position.set(v.tx + v.dist * sp * Math.sin(v.theta), v.ty - v.dist * sp * Math.cos(v.theta), 0.45 + v.dist * Math.cos(v.phi));
      camera.lookAt(controls.target);
    };
    let anim: { from: View; to: View; t0: number; dur: number } | null = null;
    const animateTo = (to: View, dur = 1200) => (anim = { from: getView(), to, t0: performance.now(), dur });
    let showcase = !!latest.current.showcase;

    let job = 0;
    const setDesign = async (id: PhotoPresetId, look: PhotoLook) => {
      if (!handMat) return;
      const my = ++job;
      const tex = await getAtlas(assetKey(id, look));
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
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const inset = Math.min(latest.current.insetBottom ?? 0, h * 0.3);
      hRatio = h / (h - inset);
      // shift the image up by half the toolbar strip so the hands sit centred in the free area
      camera.setViewOffset(w, h, 0, inset / 2, w, h);
      camera.updateProjectionMatrix();
      const fd = fitDistance();
      controls.minDistance = fd * 0.3;
      controls.maxDistance = fd * 1.25;
      bgPlace();
    };
    const ro = new ResizeObserver(resize);

    (async () => {
      man = await (await fetch("/tryon/manifest.json")).json();
      const F = man.geo.geo, T = man.geo.tex;
      const [heights, maskTex] = await Promise.all([loadHeights(F), loadTex(man.mask, false)]);
      if (disposed) return;
      // Backdrop: the photo's own silk and petals (hands removed) as a FIXED image behind the canvas, so only the
      // hands turn. A transparent shadow catcher under the hands keeps their soft contact shadow.
      el.style.backgroundColor = "#efcfcf";
      el.style.backgroundImage = `url(${man.background})`;
      el.style.backgroundRepeat = "no-repeat";
      bgImg.src = man.background;
      bgPlace = () => {
        const r = bgRect(canvas.clientWidth, canvas.clientHeight);
        el.style.backgroundSize = `${r.w}px ${r.h}px`;
        el.style.backgroundPosition = `${r.x}px ${r.y}px`;
      };
      bgPlace();
      const B = man.bgFrame, bw = (B.x1 - B.x0) * U, bh = (B.y1 - B.y0) * U;
      const bgGeo = new THREE.PlaneGeometry(bw, bh);
      bgGeo.translate(((B.x0 + B.x1) / 2 - CX) * U, -((B.y0 + B.y1) / 2 - CY) * U, -0.006);
      const catcherMat = new THREE.ShadowMaterial({ color: 0x4a1a22, opacity: 0.2 });
      const catcher = new THREE.Mesh(bgGeo, catcherMat);
      catcher.position.z = 0.002;
      catcher.receiveShadow = true;
      scene.add(catcher);
      handMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.62, metalness: 0,
        alphaMap: maskTex, alphaTest: 0.5, alphaToCoverage: true,
      });
      const handGeo = buildHandGeometry(heights, F, T);
      const hands = new THREE.Mesh(handGeo, handMat);
      // same pose as the 3D model: forearms come up from the bottom, fingers up (the photo has them hanging down)
      hands.rotation.z = Math.PI;
      hands.position.y = -2.0;
      hands.castShadow = true;
      hands.receiveShadow = true;
      scene.add(hands);
      disposables.push(bgGeo, catcherMat, maskTex, handGeo, handMat);

      setTone(latest.current.tone);
      await setDesign(latest.current.preset, latest.current.look);
      if (disposed) return;
      resize();
      ro.observe(el);
      const d = defaultView();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setView(d);
      else {
        setView({ ...d, theta: -0.55, phi: 0.85, dist: d.dist * 1.12 });
        animateTo(d, 2200);
      }
      controls.addEventListener("start", () => {
        anim = null;
        if (showcase) {
          showcase = false;
          latest.current.onShowcaseEnd?.();
        }
      });
      controls.addEventListener("change", () => {
        const t = controls.target;
        t.x = clamp(t.x, -5, 5);
        t.y = clamp(t.y, -8, 8);
      });
      const clock = new THREE.Clock();
      let first = true;
      renderer.setAnimationLoop(() => {
        const now = performance.now(), t = clock.getElapsedTime();
        if (anim) {
          const k = ease(clamp((now - anim.t0) / anim.dur, 0, 1)), a = anim.from, b = anim.to;
          setView({ theta: lerp(a.theta, b.theta, k), phi: lerp(a.phi, b.phi, k), dist: lerp(a.dist, b.dist, k), tx: lerp(a.tx, b.tx, k), ty: lerp(a.ty, b.ty, k) });
          if (k >= 1) anim = null;
        } else if (showcase) {
          const v = getView(), th = 0.42 * Math.sin(t * 0.35), ph = 0.36 + 0.1 * Math.sin(t * 0.23 + 1);
          setView({ ...v, theta: lerp(v.theta, th, 0.03), phi: lerp(v.phi, ph, 0.03) });
        }
        controls.update();
        renderer.render(scene, camera);
        if (first) {
          first = false;
          latest.current.onReady?.();
          // warm the other designs in the background so switching is instant
          const keys = man.presets.flatMap((p) => (p.stain ? [p.id, `${p.id}_stain`] : [p.id]));
          let i = 0;
          const next = () => {
            if (!disposed && i < keys.length) getAtlas(keys[i++]).then(() => setTimeout(next, 120)).catch(() => {});
          };
          setTimeout(next, 1500);
        }
      });
      api.current = {
        setDesign: (p, l) => void setDesign(p, l),
        setTone,
        handle: {
          reset: () => {
            showcase = false;
            animateTo(defaultView(), 1100);
          },
          zoom: (f) => {
            const v = getView();
            animateTo({ ...v, dist: clamp(v.dist * f, controls.minDistance, controls.maxDistance) }, 500);
          },
          showcase: (on) => {
            showcase = on;
            if (on) anim = null;
          },
          download: (name) => {
            renderer.render(scene, camera);
            // composite: fixed backdrop (same placement as on screen) + the 3D hands
            const cw = canvas.width, ch = canvas.height;
            const out = document.createElement("canvas");
            out.width = cw;
            out.height = ch;
            const g = out.getContext("2d")!;
            g.fillStyle = "#efcfcf";
            g.fillRect(0, 0, cw, ch);
            if (bgImg.complete && bgImg.naturalWidth) {
              const r = bgRect(cw, ch);
              g.drawImage(bgImg, r.x, r.y, r.w, r.h);
            }
            g.drawImage(canvas, 0, 0);
            const a = document.createElement("a");
            a.href = out.toDataURL("image/png");
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
          },
        },
      };
    })().catch((e) => !disposed && latest.current.onError?.(e as Error));

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
  }, []);

  useEffect(() => {
    api.current?.setDesign(props.preset, props.look);
  }, [props.preset, props.look]);
  useEffect(() => {
    api.current?.setTone(props.tone);
  }, [props.tone]);
  useEffect(() => {
    api.current?.handle.showcase(!!props.showcase);
  }, [props.showcase]);

  return <div ref={host} className="absolute inset-0" />;
});

export default PhotoHandScene;
