"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import ModelHandScene, { type ModelSceneHandle } from "./ModelHandScene";
import { PhotoBackdrop } from "./PhotoBackdrop";
import { getSkinTone, PHOTO_TONES, PhotoTone, setSkinTone, subscribeSkinTone, TONE_ORDER } from "@/lib/photo-tryon";

/** Height kept clear for the floating toolbar (px); the 3D view centres the hands above it. */
const TOOLBAR_SPACE = 64;

/**
 * "3D model" viewer: both hands as a closed 3D model built from the photograph (scripts/model3d), showing the
 * design's own textures (built from the artist's / admin's uploaded hand photo). Bare hands until it has them.
 * Controls: skin tone, zoom, reset.
 */
export function ModelHandViewer({
  onStage = true,
  custom,
  designName,
}: {
  designSlug?: string; // kept for callers; every design brings its own textures
  onStage?: boolean;
  /** An artist / uploaded design: its own textures on the model (never a catalogue look). */
  custom?: { front: string | null; back: string | null };
  designName?: string;
}) {
  const hasCustom = !!(custom && (custom.front || custom.back));
  const tone = useSyncExternalStore<PhotoTone>(subscribeSkinTone, getSkinTone, () => "natural");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const model = useRef<ModelSceneHandle>(null);
  const noop = useCallback(() => {}, []);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => setFailed(true), []);

  // Safety fallback: if WebGL or assets take >3.5s, dismiss the loading badge so the user is never stuck
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 3500);
    return () => clearTimeout(timer);
  }, []);

  const name = designName ?? "This design";
  const thumb = "/tryon/thumb-bare.jpg";
  const btn = `inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] px-2 text-sm font-semibold transition-colors ${
    onStage ? "bg-white/10 text-ivory hover:bg-white/18 border border-white/15" : "bg-white text-plum border hairline hover:bg-blush"
  }`;

  return (
    <div className="absolute inset-0">
      <PhotoBackdrop />
      <div className="absolute inset-0">
        {(!ready || failed) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={`${name} mehndi on photographed hands`} className="pointer-events-none absolute inset-0 m-auto h-full w-auto object-contain p-4" />
        )}
        {!failed && (
          <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            <ModelHandScene ref={model} insetBottom={TOOLBAR_SPACE} preset="bare" look="stain" custom={custom ?? { front: null, back: null }} tone={tone} showcase={false} onShowcaseEnd={noop} onReady={onReady} onError={onError} />
          </div>
        )}
        {!ready && !failed && (
          <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-plum-deep/85 px-3 py-1 text-xs text-ivory shadow-sm backdrop-blur-md" role="status">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-gold" />
              Loading 3D model…
            </span>
          </div>
        )}
        {!hasCustom && (
          <p className="pointer-events-none absolute inset-x-0 bottom-[4.25rem] flex justify-center px-4">
            <span className="rounded-full bg-plum-deep/80 px-3 py-1 text-center text-[0.72rem] text-ivory backdrop-blur-sm">3D preview of this design is being prepared</span>
          </p>
        )}
      </div>
      {/* floating over the backdrop, on a soft plum pill so the controls read on the light silk */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center px-2 pb-3">
        <div className="flex flex-nowrap items-center justify-center gap-1 rounded-[calc(var(--radius-sm)+4px)] bg-plum-deep/75 p-1 shadow-lg backdrop-blur-md sm:gap-1.5" role="toolbar" aria-label="3D hand controls">
          <button
            type="button"
            className={btn}
            aria-label={`Skin tone: ${PHOTO_TONES[tone].name}. Tap to change`}
            title={`Skin tone: ${PHOTO_TONES[tone].name}`}
            onClick={() => setSkinTone(TONE_ORDER[(TONE_ORDER.indexOf(tone) + 1) % TONE_ORDER.length])}
          >
            <span className="block h-5 w-5 rounded-full ring-2 ring-white/70" style={{ background: PHOTO_TONES[tone].sw }} />
          </button>
          <button type="button" className={btn} aria-label="Zoom in" title="Zoom in" onClick={() => model.current?.zoom(0.8)}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M9 4v10M4 9h10" /></svg>
          </button>
          <button type="button" className={btn} aria-label="Zoom out" title="Zoom out" onClick={() => model.current?.zoom(1.25)}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M4 9h10" /></svg>
          </button>
          <button type="button" className={btn} aria-label="Reset view" title="Reset view" onClick={() => model.current?.reset()}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="M3.5 9a5.5 5.5 0 1 0 1.6-3.9" />
              <path d="M3 3.5v3h3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
