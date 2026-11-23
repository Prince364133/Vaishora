"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HandSceneHandle, HandView } from "./HandScene";
import { HandIllustration } from "./HandIllustration";

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
}

export function HandViewer3D({ palmArt, backArt, region, designName, className = "", tone = "stage" }: Props) {
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
            <HandScene ref={scene} palmArt={palmArt} backArt={backArt} quality={quality} onReady={onReady} onError={onError} onViewChange={setView} />
          </div>
        )}
        {mode === "3d" && !ready && !showFeetNote && (
          <p className={`absolute bottom-3 inset-x-0 text-center text-xs ${onStage ? "text-blush/70" : "text-muted"}`} role="status">
            Loading 3D hand…
          </p>
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
