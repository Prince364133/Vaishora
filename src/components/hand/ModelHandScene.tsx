"use client";

// "3D model" viewer: the two photographed hands as a CLOSED 3D model built from the Photo 3D photograph itself
// (scripts/model3d/build_mesh.py): exact photo outline, the photo's own relief on the front, a rounded back. The front
// is textured with the design photo exactly as in Photo 3D; the back with a matching back-of-hand view of the same
// design (scripts/model3d/back_views.py). Same lights, materials, colours and framing as Photo 3D, but the pair turns
// a full 360° (drag with inertia), tilts a little, and zooms.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PHOTO_TONES, PhotoLook, PhotoPresetId, PhotoTone } from "@/lib/photo-tryon";
import { backdropRect, BACKDROP_URL } from "./PhotoBackdrop";

type Props = {
  preset: PhotoPresetId;
  /** A design's own textures (artist uploads); replace the preset when given. */
  custom?: { front: string | null; back: string | null };
  look: PhotoLook;
  tone: PhotoTone;
  showcase?: boolean;
  onShowcaseEnd?: () => void;
  insetBottom?: number;
  onReady?: () => void;
  onError?: (e: Error) => void;
};

export interface ModelSceneHandle {
  reset: () => void;
  zoom: (factor: number) => void;
  showcase: (on: boolean) => void;
  download: (name: string) => void;
  turn: (side: "palm" | "back") => void;
}

type Part = { hand: number; side: "front" | "back"; count: number; tris: number; pos: number; nor: number; uv: number; idx: number; idx32: boolean };

const PIVOT_Z = 0.3; // between the front relief and the back
const TARGET_Z = 0.45; // Photo 3D's camera target height
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** shortest signed angle from a to b */
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

const ModelHandScene = forwardRef<ModelSceneHandle, Props>(function ModelHandScene(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const api = useRef<{ setDesign: (p: PhotoPresetId, l: PhotoLook, c?: { front: string | null; back: string | null }) => void; setTone: (t: PhotoTone) => void; handle: ModelSceneHandle } | null>(null);

  useImperativeHandle(ref, () => ({
    reset: () => api.current?.handle.reset(),
    zoom: (f) => api.current?.handle.zoom(f),
    showcase: (on) => api.current?.handle.showcase(on),
    download: (n) => api.current?.handle.download(n),
    turn: (s) => api.current?.handle.turn(s),
  }));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none;cursor:grab";
    el.appendChild(canvas);

    let renderer: THREE.WebGLRenderer;
    let pmrem: THREE.PMREMGenerator;
    let envTex: THREE.Texture;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);

    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping; // the photographs' true colours, as in Photo 3D

      camera.up.set(0, 0, 1);

      // ---- same light rig as Photo 3D
      pmrem = new THREE.PMREMGenerator(renderer);
      envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTex;
      scene.environmentIntensity = 0.18;
    } catch (e) {
      latest.current.onError?.(e as Error);
      canvas.remove();
      return;
    }

    const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const hemi = new THREE.HemisphereLight(0xffffff, 0xf2d6d2, 0.62);
    hemi.position.set(0, 0, 1);
    const key = new THREE.DirectionalLight(0xfff4ec, 1.35);
    key.position.set(-11, 8, 15);
    // a soft fill from behind so the back of the hands is lit like the front when turned
    const rim = new THREE.DirectionalLight(0xfff4ec, 0.9);
    rim.position.set(11, 8, -15);
    scene.add(hemi, key, rim);

    const pair = new THREE.Group(); // pivot: centre of the pair, between front and back
    const inner = new THREE.Group();
    inner.position.z = -PIVOT_Z;
    inner.rotation.z = Math.PI; // hands rise from the bottom of the frame, fingers up (the photo has them hanging down)
    pair.position.z = PIVOT_Z;
    pair.position.y = -2.0; // fingertips clear of the viewer switch at the top; the forearms run out at the bottom
    pair.add(inner);
    scene.add(pair);

    const loader = new THREE.TextureLoader();
    const texCache = new Map<string, Promise<THREE.Texture>>();
    const loadTex = (url: string) => {
      if (!texCache.has(url))
        texCache.set(
          url,
          new Promise<THREE.Texture>((res, rej) =>
            loader.load(url, (t) => {
              t.colorSpace = THREE.SRGBColorSpace;
              t.anisotropy = ANISO;
              t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
              res(t);
            }, undefined, rej),
          ),
        );
      return texCache.get(url)!;
    };
    const keyOf = (id: PhotoPresetId, look: PhotoLook) => (void look, id);
    const frontUrl = (k: string) => `/tryon/model/front-${k}.jpg`; // the design photo, edge-filled
    const backUrl = (k: string) => `/tryon/model/back-${k}.jpg`;

    // The photo can only describe surfaces facing the camera; on the steep side walls the edge texels would smear into
    // streaks, so there the colour fades to the same texture sampled blurred (a high mip): smooth matching skin.
    const sideBlend = (m: THREE.MeshStandardMaterial) => {
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nvarying float vFacing;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFacing = abs(normal.z);");
        const blend = `
          float sideK = smoothstep(0.04, 0.32, vFacing);
          vec4 sharpC = texture2D(map, vMapUv);
          vec4 softC = texture2D(map, vMapUv, 3.0);
          vec4 photoC = mix(softC, sharpC, sideK);`;
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying float vFacing;")
          .replace("#include <map_fragment>", `${blend}\ndiffuseColor *= photoC;`)
          .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance *= photoC.rgb;");
      };
      m.customProgramCacheKey = () => "vaishora-model-side-v3";
      return m;
    };
    const mat = () =>
      sideBlend(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.62, metalness: 0 }));
    const frontMat = mat();
    const backMat = mat();
    const disposables: { dispose: () => void }[] = [envTex, pmrem, frontMat, backMat];

    let job = 0;
    const setDesign = async (id: PhotoPresetId, look: PhotoLook, custom?: { front: string | null; back: string | null }) => {
      const my = ++job;
      const k = keyOf(id, look);
      const [f, b] = await Promise.all([
        custom ? loadTex(custom.front ?? frontUrl("bare")).catch(() => loadTex(frontUrl("bare"))) : loadTex(frontUrl(k)),
        custom ? loadTex(custom.back ?? backUrl("bare")).catch(() => loadTex(backUrl("bare"))) :
        // a design without its own back view falls back to the stain back of the same design, then to bare hands
        loadTex(backUrl(k)).catch(() => loadTex(backUrl(`${id}_stain`))).catch(() => loadTex(backUrl("bare")))
          .catch(() => loadTex(backUrl("trail_stain"))),
      ]);
      if (my !== job || disposed) return;
      frontMat.map = frontMat.emissiveMap = f;
      backMat.map = backMat.emissiveMap = b;
      frontMat.needsUpdate = backMat.needsUpdate = true;
    };
    const setTone = (t: PhotoTone) => {
      const m = PHOTO_TONES[t].mul;
      for (const x of [frontMat, backMat]) {
        x.color.setRGB(m[0], m[1], m[2]);
        x.emissive.setRGB(m[0], m[1], m[2]);
      }
    };

    // ---- view: the camera stays where Photo 3D's default camera is; the hands turn
    let hRatio = 1;
    const fitDistance = () => {
      const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      return Math.max((9.3 / t) * hRatio, 6.6 / (t * camera.aspect));
    };
    const PHI = 0.2;
    let dist = 30, distTo = 30;
    const placeCamera = () => {
      camera.position.set(0, -dist * Math.sin(PHI), TARGET_Z + dist * Math.cos(PHI));
      camera.lookAt(0, 0, TARGET_Z);
    };
    let yaw = 0, pitch = 0, vYaw = 0, vPitch = 0;
    let anim: { y0: number; y1: number; p0: number; p1: number; d0: number; d1: number; t0: number; dur: number } | null = null;
    const animateTo = (y1: number, p1: number, d1: number, dur = 1100) =>
      (anim = { y0: yaw, y1: yaw + angDiff(yaw, y1), p0: pitch, p1, d0: dist, d1, t0: performance.now(), dur });
    let showcase = !!latest.current.showcase;
    const stopShowcase = () => {
      if (showcase) {
        showcase = false;
        latest.current.onShowcaseEnd?.();
      }
    };

    // ---- pointer: drag turns (with inertia), pinch / wheel zoom
    const pts = new Map<number, { x: number; y: number }>();
    let last = 0, pinch0 = 0, dist0 = 0;
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      anim = null;
      vYaw = vPitch = 0;
      stopShowcase();
      canvas.style.cursor = "grabbing";
      last = performance.now();
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        dist0 = distTo;
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0) distTo = clamp((dist0 * pinch0) / Math.max(d, 1), minD(), maxD());
        return;
      }
      const now = performance.now(), dt = Math.max(1, now - last);
      last = now;
      const k = 3.2 / Math.max(canvas.clientWidth, 1); // a full drag across ≈ 180°
      const dyaw = dx * k * Math.PI * 0.5, dpitch = dy * k * Math.PI * 0.35;
      yaw += dyaw;
      pitch = clamp(pitch + dpitch, -0.45, 0.45);
      vYaw = lerp(vYaw, dyaw / dt, 0.6);
      vPitch = lerp(vPitch, dpitch / dt, 0.6);
    };
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (!pts.size) canvas.style.cursor = "grab";
      if (performance.now() - last > 80) vYaw = vPitch = 0; // held still before release: no throw
      pinch0 = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopShowcase();
      distTo = clamp(distTo * Math.exp(e.deltaY * 0.0012), minD(), maxD());
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") vYaw = -0.004;
      else if (e.key === "ArrowRight") vYaw = 0.004;
      else return;
      e.preventDefault();
      stopShowcase();
    };
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "3D model of the hands. Drag to turn all the way round, pinch or scroll to zoom.");
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKey);
    const minD = () => fitDistance() * 0.35;
    const maxD = () => fitDistance() * 1.15;

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const inset = Math.min(latest.current.insetBottom ?? 0, h * 0.3);
      hRatio = h / (h - inset);
      camera.setViewOffset(w, h, 0, inset / 2, w, h);
      camera.updateProjectionMatrix();
      distTo = clamp(distTo, minD(), maxD());
    };
    const ro = new ResizeObserver(resize);

    (async () => {
      const meta: { parts: Part[] } = await (await fetch("/tryon/model/hands.json")).json();
      const buf = await (await fetch("/tryon/model/hands.bin")).arrayBuffer();
      if (disposed) return;
      for (const p of meta.parts) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buf, p.pos, p.count * 3), 3));
        g.setAttribute("normal", new THREE.BufferAttribute(new Int8Array(buf, p.nor, p.count * 3), 3, true));
        g.setAttribute("uv", new THREE.BufferAttribute(new Uint16Array(buf, p.uv, p.count * 2), 2, true));
        g.setIndex(new THREE.BufferAttribute(p.idx32 ? new Uint32Array(buf, p.idx, p.tris * 3) : new Uint16Array(buf, p.idx, p.tris * 3), 1));
        g.computeBoundingSphere();
        inner.add(new THREE.Mesh(g, p.side === "front" ? frontMat : backMat));
        disposables.push(g);
      }
      setTone(latest.current.tone);
      await setDesign(latest.current.preset, latest.current.look, latest.current.custom);
      if (disposed) return;
      resize();
      ro.observe(el);
      dist = distTo = fitDistance();
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        // entrance: a gentle half-turn reveal ending on the palms, like Photo 3D's opening move
        yaw = -0.9;
        animateTo(0, 0, dist);
      }
      const clock = new THREE.Clock();
      let first = true;
      renderer.setAnimationLoop(() => {
        const now = performance.now(), dt = Math.min(clock.getDelta() * 1000, 50);
        if (anim) {
          const k = ease(clamp((now - anim.t0) / anim.dur, 0, 1));
          yaw = lerp(anim.y0, anim.y1, k);
          pitch = lerp(anim.p0, anim.p1, k);
          distTo = dist = lerp(anim.d0, anim.d1, k);
          if (k >= 1) anim = null;
        } else if (showcase) {
          yaw += dt * 0.00045; // slow full turn
          pitch = lerp(pitch, 0.12 * Math.sin(now * 0.0004), 0.02);
        } else if (!pts.size) {
          // inertia
          yaw += vYaw * dt;
          pitch = clamp(pitch + vPitch * dt, -0.45, 0.45);
          const f = Math.pow(0.94, dt / 16.7);
          vYaw *= f;
          vPitch *= f;
          if (Math.abs(vYaw) < 1e-5) vYaw = 0;
          if (Math.abs(vPitch) < 1e-5) vPitch = 0;
        }
        dist = lerp(dist, distTo, 0.15);
        pair.rotation.set(pitch, yaw, 0, "YXZ");
        placeCamera();
        renderer.render(scene, camera);
        if (first) {
          first = false;
          latest.current.onReady?.();
        }
      });
      const bg = new Image();
      bg.src = BACKDROP_URL;
      api.current = {
        setDesign: (p, l, c) => void setDesign(p, l, c),
        setTone,
        handle: {
          reset: () => {
            stopShowcase();
            vYaw = vPitch = 0;
            animateTo(0, 0, fitDistance());
          },
          zoom: (f) => {
            anim = null;
            distTo = clamp(distTo * f, minD(), maxD());
          },
          showcase: (on) => {
            showcase = on;
            if (on) {
              anim = null;
              vYaw = vPitch = 0;
            }
          },
          turn: (side) => {
            stopShowcase();
            vYaw = vPitch = 0;
            animateTo(side === "back" ? Math.PI : 0, 0, distTo, 1300);
          },
          download: (name) => {
            renderer.render(scene, camera);
            const cw = canvas.width, ch = canvas.height;
            const out = document.createElement("canvas");
            out.width = cw;
            out.height = ch;
            const g = out.getContext("2d")!;
            g.fillStyle = "#efcfcf";
            g.fillRect(0, 0, cw, ch);
            if (bg.complete && bg.naturalWidth) {
              const r = backdropRect(cw, ch);
              g.drawImage(bg, r.x, r.y, r.w, r.h);
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
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      texCache.forEach((p) => p.then((t) => t.dispose()).catch(() => {}));
      disposables.forEach((x) => x.dispose());
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    api.current?.setDesign(props.preset, props.look, props.custom);
  }, [props.preset, props.look, props.custom?.front, props.custom?.back]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.current?.setTone(props.tone);
  }, [props.tone]);
  useEffect(() => {
    api.current?.handle.showcase(!!props.showcase);
  }, [props.showcase]);

  return <div ref={host} className="absolute inset-0" />;
});

export default ModelHandScene;
