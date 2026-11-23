"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import type { PhotoSceneHandle } from "./PhotoHandScene";
import { PHOTO_MATCH, PHOTO_PRESETS, PHOTO_TONES, PhotoLook, PhotoPresetId, PhotoTone } from "@/lib/photo-tryon";

const PhotoHandScene = dynamic(() => import("./PhotoHandScene"), { ssr: false });

const TONE_ORDER: PhotoTone[] = ["natural", "fair", "tan", "deep"];

/** "Photo 3D" viewer: photographed hands with photo mehndi, mapped from the selected catalogue design. */
export function PhotoHandViewer({ designSlug, onStage = true }: { designSlug?: string; onStage?: boolean }) {
  const match = designSlug ? PHOTO_MATCH[designSlug] : undefined;
  // A manual pick applies only to the design it was made on; a new catalogue design resets it.
  const [pick, setPick] = useState<{ slug?: string; id: PhotoPresetId } | null>(null);
  const preset: PhotoPresetId = pick && pick.slug === designSlug ? pick.id : match?.id ?? "royal";
  const [look, setLook] = useState<PhotoLook>("stain");
  const [tone, setTone] = useState<PhotoTone>("natural");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const scene = useRef<PhotoSceneHandle>(null);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => setFailed(true), []);

  const presetName = PHOTO_PRESETS.find((p) => p.id === preset)?.name ?? "";
  const bare = preset === "bare";
  const thumb = `/tryon/thumb-${bare ? "bare" : look === "stain" ? `${preset}_stain` : preset}.jpg`;
  const btn = `inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] px-2 text-sm font-semibold transition-colors ${
    onStage ? "bg-white/10 text-ivory hover:bg-white/18 border border-white/15" : "bg-white text-plum border hairline hover:bg-blush"
  }`;

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="relative min-h-0 flex-1">
        {failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={`${presetName} mehndi on photographed hands`} className="absolute inset-0 m-auto h-full w-auto object-contain p-4" />
        ) : (
          <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}>
            <PhotoHandScene ref={scene} preset={preset} look={bare ? "paste" : look} tone={tone} onReady={onReady} onError={onError} />
          </div>
        )}
        {!ready && !failed && (
          <p className={`absolute inset-x-0 bottom-3 text-center text-xs ${onStage ? "text-blush/70" : "text-muted"}`} role="status">
            Loading photo 3D…
          </p>
        )}
        <p className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center px-4">
          <span className="rounded-full bg-plum-deep/80 px-3 py-1 text-center text-[0.72rem] text-ivory backdrop-blur-sm">
          {bare ? "Bare hands" : `${presetName}${match && !match.exact && !pick ? " — closest photo look" : ""} · ${look === "stain" ? "dried stain" : "fresh paste"}`}
          </span>
        </p>
      </div>
      <div className="relative z-10 flex flex-nowrap items-center justify-center gap-1 px-2 pb-3 sm:gap-1.5" role="toolbar" aria-label="Photo 3D controls">
        <div className={`inline-flex shrink-0 rounded-[var(--radius-sm)] p-0.5 ${onStage ? "bg-white/10" : "bg-blush"}`} role="radiogroup" aria-label="Henna look">
          {(["paste", "stain"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={look === l}
              disabled={bare}
              onClick={() => setLook(l)}
              className={`h-11 rounded-[5px] px-3 text-sm font-semibold transition-colors disabled:opacity-40 ${
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
          onClick={() => setTone(TONE_ORDER[(TONE_ORDER.indexOf(tone) + 1) % TONE_ORDER.length])}
        >
          <span className="block h-5 w-5 rounded-full ring-2 ring-white/70" style={{ background: PHOTO_TONES[tone].sw }} />
        </button>
        <label className="sr-only" htmlFor="photo-look-select">Photo design</label>
        <select
          id="photo-look-select"
          className={`${btn} w-[7.5rem] cursor-pointer appearance-none truncate text-left`}
          value={preset}
          onChange={(e) => setPick({ slug: designSlug, id: e.target.value as PhotoPresetId })}
        >
          {PHOTO_PRESETS.map((p) => (
            <option key={p.id} value={p.id} className="text-plum">
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className={btn} aria-label="Reset view" title="Reset view" onClick={() => scene.current?.reset()}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
            <path d="M3.5 9a5.5 5.5 0 1 0 1.6-3.9" />
            <path d="M3 3.5v3h3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
