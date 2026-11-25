"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import PhotoHandScene, { type PhotoSceneHandle } from "./PhotoHandScene";
import ModelHandScene, { type ModelSceneHandle } from "./ModelHandScene";
import { PhotoBackdrop } from "./PhotoBackdrop";
import { getSkinTone, PHOTO_MATCH, PHOTO_PRESETS, PHOTO_TONES, PhotoLook, PhotoPresetId, PhotoTone, setSkinTone, subscribeSkinTone, TONE_ORDER } from "@/lib/photo-tryon";

/** Height kept clear for the floating toolbar + label (px); the 3D view centres the hands above it. */
const TOOLBAR_SPACE = 76;

/** "Photo 3D" viewer: photographed hands with photo mehndi, mapped from the selected catalogue design. */
/** `variant="model"` is the "3D model" tab: the same hands as a closed 3D model built from the photo, turning 360°. */
export function PhotoHandViewer({ designSlug, onStage = true, variant = "photo" }: { designSlug?: string; onStage?: boolean; variant?: "photo" | "model" }) {
  const match = designSlug ? PHOTO_MATCH[designSlug] : undefined;
  // A manual pick applies only to the design it was made on; a new catalogue design resets it.
  const [pick, setPick] = useState<{ slug?: string; id: PhotoPresetId } | null>(null);
  const preset: PhotoPresetId = pick && pick.slug === designSlug ? pick.id : match?.id ?? "royal";
  const [look, setLook] = useState<PhotoLook>("stain");
  const tone = useSyncExternalStore<PhotoTone>(subscribeSkinTone, getSkinTone, () => "natural");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const scene = useRef<PhotoSceneHandle>(null);
  const model = useRef<ModelSceneHandle>(null);
  const [side, setSide] = useState<"palm" | "back">("palm");
  const isModel = variant === "model";
  const ctl = (): PhotoSceneHandle | null => (isModel ? model.current : scene.current);
  const [showcase, setShowcase] = useState(false);
  const onShowcaseEnd = useCallback(() => setShowcase(false), []);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => setFailed(true), []);

  // Safety fallback: if WebGL or assets take >3.5s, dismiss loading badge so the user is never stuck
  useEffect(() => {
    const timer = setTimeout(() => {
      setReady((prev) => prev || true);
    }, 3500);
    return () => clearTimeout(timer);
  }, []);

  const presetName = PHOTO_PRESETS.find((p) => p.id === preset)?.name ?? "";
  const bare = preset === "bare";
  const thumb = `/tryon/thumb-${bare ? "bare" : look === "stain" ? `${preset}_stain` : preset}.jpg`;
  const btn = `inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] px-2 text-sm @max-[340px]:min-w-9 @max-[340px]:px-1 font-semibold transition-colors ${
    onStage ? "bg-white/10 text-ivory hover:bg-white/18 border border-white/15" : "bg-white text-plum border hairline hover:bg-blush"
  }`;

  return (
    <div className="absolute inset-0">
      <PhotoBackdrop />
      <div className="absolute inset-0">
        {(!ready || failed) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt={`${presetName} mehndi on photographed hands`}
            className="pointer-events-none absolute inset-0 m-auto h-full w-auto object-contain p-4"
          />
        )}
        {!failed && (
          <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            {isModel ? (
              <ModelHandScene ref={model} insetBottom={TOOLBAR_SPACE} preset={preset} look={bare ? "paste" : look} tone={tone} showcase={showcase} onShowcaseEnd={onShowcaseEnd} onReady={onReady} onError={onError} />
            ) : (
              <PhotoHandScene ref={scene} insetBottom={TOOLBAR_SPACE} preset={preset} look={bare ? "paste" : look} tone={tone} showcase={showcase} onShowcaseEnd={onShowcaseEnd} onReady={onReady} onError={onError} />
            )}
          </div>
        )}
        {!ready && !failed && (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center z-10">
            <span className="inline-flex items-center gap-2 rounded-full bg-plum-deep/85 px-3 py-1 text-xs text-ivory backdrop-blur-md shadow-sm" role="status">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-gold" />
              {isModel ? "Loading 3D model…" : "Loading photo 3D…"}
            </span>
          </div>
        )}
        <p className="pointer-events-none absolute inset-x-0 bottom-[4.25rem] flex justify-center px-4">
          <span className="rounded-full bg-plum-deep/80 px-3 py-1 text-center text-[0.72rem] text-ivory backdrop-blur-sm">
          {bare ? "Bare hands" : `${presetName}${match && !match.exact && !pick ? " — closest photo look" : ""} · ${look === "stain" ? "dried stain" : "fresh paste"}`}
          </span>
        </p>
      </div>
      {/* floating over the photo backdrop, on a soft plum pill so the controls read on the light silk */}
      <div className="@container absolute inset-x-0 bottom-0 z-10 flex justify-center px-2 pb-3 max-[359px]:px-1">
      <div className="flex max-w-full flex-nowrap items-center justify-center gap-1 rounded-[calc(var(--radius-sm)+4px)] bg-plum-deep/75 p-1 shadow-lg backdrop-blur-md @min-[500px]:gap-1.5 @max-[340px]:gap-0.5 @max-[340px]:p-0.5" role="toolbar" aria-label={isModel ? "3D hand controls" : "Photo 3D controls"}>
        <div className={`inline-flex shrink-0 rounded-[var(--radius-sm)] p-0.5 ${onStage ? "bg-white/10" : "bg-blush"}`} role="radiogroup" aria-label="Henna look">
          {(["paste", "stain"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={look === l}
              disabled={bare}
              onClick={() => setLook(l)}
              className={`h-11 rounded-[5px] px-3 @max-[420px]:px-2 @max-[340px]:px-1 @max-[340px]:text-[13px] text-sm font-semibold transition-colors disabled:opacity-40 ${
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
        <label className="sr-only" htmlFor="photo-look-select">Photo design</label>
        <select
          id="photo-look-select"
          className={`${btn} w-[7.5rem] @max-[420px]:w-[6.25rem] @max-[340px]:w-[4.25rem] @max-[340px]:px-1.5 cursor-pointer appearance-none truncate text-left`}
          value={preset}
          onChange={(e) => setPick({ slug: designSlug, id: e.target.value as PhotoPresetId })}
        >
          {PHOTO_PRESETS.map((p) => (
            <option key={p.id} value={p.id} className="text-plum">
              {p.name}
            </option>
          ))}
        </select>
        {isModel ? (
          <>
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
              className={`${btn} @max-[500px]:hidden ${showcase ? (onStage ? "!bg-ivory !text-plum" : "!bg-plum !text-ivory") : ""}`}
              aria-pressed={showcase}
              aria-label="Spin 360°"
              title="Spin 360°"
              onClick={() => setShowcase((v) => !v)}
            >
              360°
            </button>
            <button type="button" className={`${btn} @max-[620px]:hidden`} aria-label="Zoom in" title="Zoom in" onClick={() => model.current?.zoom(0.8)}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M9 4v10M4 9h10" /></svg>
            </button>
            <button type="button" className={`${btn} @max-[620px]:hidden`} aria-label="Zoom out" title="Zoom out" onClick={() => model.current?.zoom(1.25)}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M4 9h10" /></svg>
            </button>
          </>
        ) : (
          <>
        <button
          type="button"
          className={`${btn} @max-[500px]:hidden ${showcase ? (onStage ? "!bg-ivory !text-plum" : "!bg-plum !text-ivory") : ""}`}
          aria-pressed={showcase}
          aria-label="Showcase: gentle automatic turn"
          title="Showcase"
          onClick={() => setShowcase((v) => !v)}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14.5 9A5.5 5.5 0 1 1 9 3.5c1.8 0 3.3.8 4.3 2" />
            <path d="M13.8 2.8v2.9h-2.9" />
          </svg>
        </button>
        <button
          type="button"
          className={`${btn} @max-[500px]:hidden`}
          aria-label="Download image"
          title="Download image"
          onClick={() => ctl()?.download(`vaishora-mehndi-${preset}${bare ? "" : `-${look}`}.png`)}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 3v8.5M5.5 8 9 11.5 12.5 8M3.5 14.5h11" />
          </svg>
        </button>
          </>
        )}
        <button type="button" className={btn} aria-label="Reset view" title="Reset view" onClick={() => { setShowcase(false); setSide("palm"); ctl()?.reset(); }}>
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
