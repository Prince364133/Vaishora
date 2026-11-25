"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import ModelHandScene, { type ModelSceneHandle } from "./ModelHandScene";
import { PhotoBackdrop } from "./PhotoBackdrop";
import { getSkinTone, PHOTO_MATCH, PHOTO_PRESETS, PHOTO_TONES, PhotoLook, PhotoPresetId, PhotoTone, setSkinTone, subscribeSkinTone, TONE_ORDER } from "@/lib/photo-tryon";

/** Height kept clear for the floating toolbar + label (px); the 3D view centres the hands above it. */
const TOOLBAR_SPACE = 76;

/**
 * "3D model" viewer: both hands as a closed 3D model built from the photograph (scripts/model3d), with the
 * photographed mehndi of the closest catalogue look, turning 360°.
 */
export function ModelHandViewer({ designSlug, onStage = true }: { designSlug?: string; onStage?: boolean }) {
  const match = designSlug ? PHOTO_MATCH[designSlug] : undefined;
  // A manual pick applies only to the design it was made on; a new catalogue design resets it.
  const [pick, setPick] = useState<{ slug?: string; id: PhotoPresetId } | null>(null);
  const preset: PhotoPresetId = pick && pick.slug === designSlug ? pick.id : match?.id ?? "royal";
  const [look, setLook] = useState<PhotoLook>("stain");
  const tone = useSyncExternalStore<PhotoTone>(subscribeSkinTone, getSkinTone, () => "natural");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const model = useRef<ModelSceneHandle>(null);
  const [side, setSide] = useState<"palm" | "back">("palm");
  const [showcase, setShowcase] = useState(false);
  const onShowcaseEnd = useCallback(() => setShowcase(false), []);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => setFailed(true), []);

  // Safety fallback: if WebGL or assets take >3.5s, dismiss the loading badge so the user is never stuck
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 3500);
    return () => clearTimeout(timer);
  }, []);

  const presetName = PHOTO_PRESETS.find((p) => p.id === preset)?.name ?? "";
  const bare = preset === "bare";
  const thumb = `/tryon/thumb-${bare ? "bare" : look === "stain" ? `${preset}_stain` : preset}.jpg`;
  const btn = `inline-flex h-11 min-w-11 shrink-0 max-[419px]:min-w-10 items-center justify-center rounded-[var(--radius-sm)] px-2 text-sm font-semibold transition-colors ${
    onStage ? "bg-white/10 text-ivory hover:bg-white/18 border border-white/15" : "bg-white text-plum border hairline hover:bg-blush"
  }`;

  return (
    <div className="absolute inset-0">
      <PhotoBackdrop />
      <div className="absolute inset-0">
        {(!ready || failed) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={`${presetName} mehndi on photographed hands`} className="pointer-events-none absolute inset-0 m-auto h-full w-auto object-contain p-4" />
        )}
        {!failed && (
          <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            <ModelHandScene ref={model} insetBottom={TOOLBAR_SPACE} preset={preset} look={bare ? "paste" : look} tone={tone} showcase={showcase} onShowcaseEnd={onShowcaseEnd} onReady={onReady} onError={onError} />
          </div>
        )}
        {!ready && !failed && (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-plum-deep/85 px-3 py-1 text-xs text-ivory shadow-sm backdrop-blur-md" role="status">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-gold" />
              Loading 3D model…
            </span>
          </div>
        )}
        <p className="pointer-events-none absolute inset-x-0 bottom-[4.25rem] flex justify-center px-4">
          <span className="rounded-full bg-plum-deep/80 px-3 py-1 text-center text-[0.72rem] text-ivory backdrop-blur-sm">
            {bare ? "Bare hands" : `${presetName}${match && !match.exact && !pick ? " — closest photo look" : ""} · ${look === "stain" ? "dried stain" : "fresh paste"}`}
          </span>
        </p>
      </div>
      {/* floating over the backdrop, on a soft plum pill so the controls read on the light silk */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center px-2 pb-3">
        <div className="flex flex-nowrap items-center justify-center gap-1 rounded-[calc(var(--radius-sm)+4px)] bg-plum-deep/75 p-1 shadow-lg backdrop-blur-md sm:gap-1.5" role="toolbar" aria-label="3D hand controls">
          <div className={`inline-flex shrink-0 rounded-[var(--radius-sm)] p-0.5 ${onStage ? "bg-white/10" : "bg-blush"}`} role="radiogroup" aria-label="Henna look">
            {(["paste", "stain"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={look === l}
                disabled={bare}
                onClick={() => setLook(l)}
                className={`h-11 rounded-[5px] px-3 text-sm font-semibold transition-colors disabled:opacity-40 max-[419px]:px-2 ${
                  look === l ? (onStage ? "bg-ivory text-plum" : "bg-plum text-ivory") : onStage ? "text-ivory" : "text-plum"
                }`}
              >
                {l === "paste" ? "Paste" : "Stain"}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={btn}
            aria-label={`Skin tone: ${PHOTO_TONES[tone].name}. Tap to change`}
            title={`Skin tone: ${PHOTO_TONES[tone].name}`}
            onClick={() => setSkinTone(TONE_ORDER[(TONE_ORDER.indexOf(tone) + 1) % TONE_ORDER.length])}
          >
            <span className="block h-5 w-5 rounded-full ring-2 ring-white/70" style={{ background: PHOTO_TONES[tone].sw }} />
          </button>
          <label className="sr-only" htmlFor="model-look-select">Design look</label>
          <select
            id="model-look-select"
            className={`${btn} w-[7.5rem] cursor-pointer appearance-none truncate text-left max-[419px]:w-[4.75rem] max-[339px]:hidden`}
            value={preset}
            onChange={(e) => setPick({ slug: designSlug, id: e.target.value as PhotoPresetId })}
          >
            {PHOTO_PRESETS.map((p) => (
              <option key={p.id} value={p.id} className="text-plum">
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={btn}
            aria-label={side === "palm" ? "Turn to the back of the hands" : "Turn to the palms"}
            title={side === "palm" ? "Show back" : "Show palms"}
            onClick={() => {
              const next = side === "palm" ? "back" : "palm";
              setShowcase(false);
              setSide(next);
              model.current?.turn(next);
            }}
          >
            {side === "palm" ? "Back" : "Palm"}
          </button>
          <button
            type="button"
            className={`${btn} max-[419px]:hidden ${showcase ? (onStage ? "!bg-ivory !text-plum" : "!bg-plum !text-ivory") : ""}`}
            aria-pressed={showcase}
            aria-label="Spin 360°"
            title="Spin 360°"
            onClick={() => setShowcase((v) => !v)}
          >
            360°
          </button>
          <button type="button" className={`${btn} max-[639px]:hidden`} aria-label="Zoom in" title="Zoom in" onClick={() => model.current?.zoom(0.8)}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M9 4v10M4 9h10" /></svg>
          </button>
          <button type="button" className={`${btn} max-[639px]:hidden`} aria-label="Zoom out" title="Zoom out" onClick={() => model.current?.zoom(1.25)}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M4 9h10" /></svg>
          </button>
          <button
            type="button"
            className={`${btn} max-[379px]:hidden`}
            aria-label="Reset view"
            title="Reset view"
            onClick={() => {
              setShowcase(false);
              setSide("palm");
              model.current?.reset();
            }}
          >
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
