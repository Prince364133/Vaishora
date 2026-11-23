"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { HandSceneHandle, HandView } from "./HandScene";
import { HandIllustration } from "./HandIllustration";
import { PhotoHandViewer } from "./PhotoHandViewer";
import { getViewerMode, setViewerMode, subscribeViewerMode, ViewerMode } from "@/lib/photo-tryon";
import { catalogHasStain, catalogPhotoPalm, PhotoPalmLook } from "@/lib/mehndi/photo-palm";

const HandScene = dynamic(() => import("./HandScene"), { ssr: false });

type Mode = "checking" | "3d" | "fallback";

function detectWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function pickQuality(): "high" | "low" {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return "low";
  if ((nav.deviceMemory ?? 8) <= 3) return "low";
  if ((navigator.hardwareConcurrency ?? 8) <= 4) return "low";
  return window.innerWidth < 768 ? "low" : "high";
}

interface Props {
  palmArt: string | null;
  backArt: string | null;
  region: "palm" | "back" | "palm_back" | "feet";
  designName: string;
  className?: string;
  /** Visual variant: "stage" sits on plum, "light" on ivory. */
  tone?: "stage" | "light";
  /** Catalogue slug, used to pick the closest look in the Photo 3D viewer. */
  designSlug?: string;
  /** Photo albedo assets ("palm_photo" / "back_photo"); built-in catalogue photos are used when absent. */
  palmPhoto?: string | null;
  backPhoto?: string | null;
}

/**
 * Hand stage with a viewer switch: "Sculpted" (the CC0 3D hand with projected mehndi) or "Photo"
 * (mehndi-3d-tryon: photographed hands rebuilt as relief). The choice is shared by every stage and
 * remembered on the device, so the two can be compared before deciding which to keep.
 */
export function HandViewer3D(props: Props) {
  const mode = useSyncExternalStore<ViewerMode>(subscribeViewerMode, getViewerMode, () => "sculpted");
  const onStage = (props.tone ?? "stage") === "stage";
  const feet = props.region === "feet";
  return (
    <div className={`flex flex-col ${props.className || "relative"}`}>
      {!feet && (
        <div className="absolute inset-x-0 top-3 z-20 flex justify-center pointer-events-none">
          <div
            className={`pointer-events-auto inline-flex rounded-full p-0.5 text-xs font-semibold shadow-sm ${onStage ? "bg-plum-deep/80 ring-1 ring-gold/40" : "bg-blush ring-1 ring-[var(--color-line)]"}`}
            role="radiogroup"
            aria-label="3D viewer"
          >
            {(["sculpted", "photo"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setViewerMode(m)}
                className={`min-h-9 rounded-full px-3.5 transition-colors ${
                  mode === m ? (onStage ? "bg-ivory text-plum" : "bg-plum text-ivory") : onStage ? "text-blush" : "text-plum"
                }`}
              >
                {m === "sculpted" ? "3D model" : "Photo 3D"}
              </button>
            ))}
          </div>
        </div>
      )}
      {mode === "photo" && !feet ? (
        <div className="relative min-h-0 flex-1">
          <PhotoHandViewer designSlug={props.designSlug} onStage={onStage} />
        </div>
      ) : (
        <SculptedHandViewer {...props} className="relative min-h-0 flex-1" />
      )}
    </div>
  );
}

function SculptedHandViewer({ palmArt, backArt, region, designName, className = "", tone = "stage", designSlug, palmPhoto, backPhoto }: Props) {
  const [look, setLook] = useState<PhotoPalmLook>("stain");
  const [mode, setMode] = useState<Mode>("checking");
  const [quality, setQuality] = useState<"high" | "low">("low");
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<HandView>("palm");
  const [explore, setExplore] = useState(false);
  const scene = useRef<HandSceneHandle>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Defer the 3D bundle until the viewer is near the viewport so text and CTAs paint first.
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setQuality(pickQuality());
        setMode(detectWebGL() ? "3d" : "fallback");
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Turn to the side that actually has artwork when the design changes.
  useEffect(() => {
    if (region === "back") scene.current?.setView("back");
    else if (region === "palm") scene.current?.setView("palm");
  }, [region, palmArt, backArt]);

  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => setMode("fallback"), []);

  const fallbackSide = region === "feet" ? "feet" : view === "back" && backArt ? "back" : palmArt ? "palm" : backArt ? "back" : "palm";
  const fallbackArt = region === "feet" ? palmArt : fallbackSide === "back" ? backArt : palmArt;
  const showFeetNote = region === "feet";
  const onStage = tone === "stage";
  // Real photographed palm (skin + henna) for designs that have one; the procedural mask otherwise.
  const builtInPhoto = palmPhoto ? null : catalogPhotoPalm(designSlug, look, quality);
  const photoPalm = region === "feet" ? null : palmPhoto ?? builtInPhoto;
  const photoBack = region === "feet" ? null : backPhoto ?? null;
  const showLook = mode === "3d" && !!builtInPhoto && catalogHasStain(designSlug) && region !== "feet";

  // Compact 44px icon buttons so the whole bar stays on one row down to 320px wide screens.
  const btn = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors ${
    onStage ? "bg-white/10 text-ivory hover:bg-white/18 border border-white/15" : "bg-white text-plum border hairline hover:bg-blush"
  }`;
  const icon = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

  return (
    <div ref={root} className={`flex flex-col ${className || "relative"}`}>
      <div className={`hand-canvas relative flex-1 min-h-0 ${explore ? "explore" : ""}`}>
        {(mode !== "3d" || !ready || showFeetNote) && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <HandIllustration
              side={fallbackSide}
              art={fallbackArt}
              className={`h-full max-h-full w-auto transition-opacity duration-500 ${mode === "3d" && !showFeetNote ? "opacity-60" : "opacity-100"}`}
              label={`${designName} mehndi design${showFeetNote ? " for feet" : ""}`}
            />
          </div>
        )}
        {mode === "3d" && !showFeetNote && (
          <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}>
            <HandScene ref={scene} palmArt={palmArt} backArt={backArt} palmPhoto={photoPalm} backPhoto={photoBack} quality={quality} onReady={onReady} onError={onError} onViewChange={setView} />
          </div>
        )}
        {mode === "3d" && !ready && !showFeetNote && (
          <p className={`absolute bottom-3 inset-x-0 text-center text-xs ${onStage ? "text-blush/70" : "text-muted"}`} role="status">
            Loading 3D hand…
          </p>
        )}
        {showLook && (
          <div
            className={`absolute right-3 top-14 z-10 inline-flex rounded-full p-0.5 text-xs font-semibold ${onStage ? "bg-plum-deep/70 ring-1 ring-white/15" : "bg-blush ring-1 ring-[var(--color-line)]"}`}
            role="radiogroup"
            aria-label="Mehndi look"
          >
            {(["stain", "paste"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={look === l}
                onClick={() => setLook(l)}
                className={`min-h-9 rounded-full px-3 transition-colors ${
                  look === l ? (onStage ? "bg-ivory text-plum" : "bg-plum text-ivory") : onStage ? "text-blush" : "text-plum"
                }`}
              >
                {l === "stain" ? "Stain" : "Paste"}
              </button>
            ))}
          </div>
        )}
      </div>

      {showFeetNote ? (
        <p className={`px-4 pb-3 text-center text-sm ${onStage ? "text-blush/80" : "text-muted"}`}>Feet designs are shown as an illustration. The 3D preview is for hands.</p>
      ) : (
        <div className="relative z-10 flex flex-nowrap items-center justify-center gap-1 px-2 pb-3 sm:gap-1.5" role="toolbar" aria-label="3D hand controls">
          <div className={`inline-flex shrink-0 rounded-[var(--radius-sm)] p-0.5 ${onStage ? "bg-white/10" : "bg-blush"}`} role="radiogroup" aria-label="Hand side">
            {(["palm", "back"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                disabled={mode !== "3d" && !(v === "palm" ? palmArt : backArt)}
                onClick={() => {
                  setView(v);
                  scene.current?.setView(v);
                }}
                className={`h-11 min-w-11 px-3 rounded-[5px] text-sm font-semibold transition-colors disabled:opacity-40 ${
                  view === v ? (onStage ? "bg-ivory text-plum" : "bg-plum text-ivory") : onStage ? "text-ivory" : "text-plum"
                }`}
              >
                {v === "palm" ? "Palm" : "Back"}
              </button>
            ))}
          </div>
          {mode === "3d" && (
            <>
              {/* Below 360px the stage is too narrow for six 44px controls; pinch-zoom covers zooming there. */}
              <button type="button" className={`${btn} max-[359px]:hidden`} onClick={() => scene.current?.zoom(0.8)} aria-label="Zoom in" title="Zoom in">
                <svg {...icon}><path d="M9 4v10M4 9h10" /></svg>
              </button>
              <button type="button" className={`${btn} max-[359px]:hidden`} onClick={() => scene.current?.zoom(1.25)} aria-label="Zoom out" title="Zoom out">
                <svg {...icon}><path d="M4 9h10" /></svg>
              </button>
              <button
                type="button"
                className={btn}
                aria-label="Reset view"
                title="Reset view"
                onClick={() => {
                  scene.current?.reset();
                  setView("palm");
                }}
              >
                <svg {...icon}><path d="M3.5 9a5.5 5.5 0 1 0 1.6-3.9" /><path d="M3 3.5v3h3" /></svg>
              </button>
              <button
                type="button"
                className={`${btn} md:hidden ${explore ? (onStage ? "!bg-ivory !text-plum" : "!bg-plum !text-ivory") : ""}`}
                aria-pressed={explore}
                aria-label="Free rotate"
                title={explore ? "Done rotating" : "Free rotate"}
                onClick={() => setExplore((v) => !v)}
              >
                <svg {...icon}><ellipse cx="9" cy="9" rx="6.5" ry="2.6" /><path d="M9 2.5v13" /><path d="M13.6 6.2l1.6-.4-.3 1.6" /></svg>
              </button>
            </>
          )}
        </div>
      )}
      {mode === "3d" && !showFeetNote && (
        <p className={`sr-only`}>
          Drag sideways to turn the hand, pinch or use the zoom buttons to look closer. Use Free rotate to tilt the wrist on touch screens.
        </p>
      )}
    </div>
  );
}
