"use client";

import { useEffect, useRef, useState } from "react";
import { LazyHandViewer3D } from "@/components/hand/LazyHandViewer3D";
import { youTubeId } from "@/lib/youtube";

type Assets = { palm?: string; back?: string; feet?: string; palm_photo?: string; back_photo?: string; model_front?: string; model_back?: string };

/**
 * Design media: a "Photos" view (optional YouTube video first, then photos — swipe, arrows, dots) and a
 * "3D" view of the design on the hand. The video autoplays muted and loops; it cannot be paused, only
 * unmuted. Each view mounts only when chosen (the 3D bundle and the video load lazily).
 */
export function DesignMedia({
  name,
  slug,
  region,
  photos = [],
  videoUrl,
  assets = {},
  has3D,
  custom = false,
  className = "",
}: {
  name: string;
  slug?: string;
  region: "palm" | "back" | "palm_back" | "feet";
  photos?: string[];
  videoUrl?: string | null;
  assets?: Assets;
  /** Show the 3D tab (defaults to: the design has 3D artwork, or has no photos at all). */
  has3D?: boolean;
  /** Artist design: its 3D view shows only its own extracted artwork. */
  custom?: boolean;
  className?: string;
}) {
  const vid = youTubeId(videoUrl);
  const hasPhotos = photos.length > 0 || !!vid;
  const show3D = has3D ?? (!!(assets.palm || assets.back || assets.feet || assets.model_front || assets.model_back) || !hasPhotos);
  const [view, setView] = useState<"photos" | "3d">(hasPhotos ? "photos" : "3d");
  const isFeet = region === "feet";

  return (
    <div className={`${className || "relative h-full"} overflow-hidden bg-plum`}>
      {view === "photos" && hasPhotos ? (
        <Carousel name={name} photos={photos} videoId={vid} />
      ) : (
        <LazyHandViewer3D
          palmArt={isFeet ? assets.feet ?? null : assets.palm ?? null}
          backArt={isFeet ? null : assets.back ?? null}
          region={region}
          designName={name}
          designSlug={slug}
          palmPhoto={assets.palm_photo ?? null}
          backPhoto={assets.back_photo ?? null}
          customOnly={custom}
          modelFront={assets.model_front ?? null}
          modelBack={assets.model_back ?? null}
          className="absolute inset-0 pt-6"
        />
      )}
      {hasPhotos && show3D && (
        <div className="absolute top-4 left-1/2 z-20 inline-flex -translate-x-1/2 whitespace-nowrap rounded-full bg-plum-deep/80 p-0.5 text-xs font-semibold shadow ring-1 ring-gold/40 backdrop-blur" role="radiogroup" aria-label="View">
          {(
            [
              ["photos", vid ? "Video & photos" : "Photos"],
              ["3d", "3D"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={view === k}
              onClick={() => setView(k)}
              className={`min-h-9 rounded-full px-3.5 transition-colors ${view === k ? "bg-ivory text-plum" : "text-blush hover:text-ivory"}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Carousel({ name, photos, videoId }: { name: string; photos: string[]; videoId: string | null }) {
  const track = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const count = photos.length + (videoId ? 1 : 0);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const go = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: Math.max(0, Math.min(count - 1, i)) * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="absolute inset-0" role="region" aria-roledescription="carousel" aria-label={`Video and photos of ${name}`}>
      <ul ref={track} className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {videoId && (
          <li className="relative h-full w-full flex-none snap-center" aria-roledescription="slide" aria-label={`Video, 1 of ${count}`}>
            <AutoVideo id={videoId} title={`${name} — video`} />
          </li>
        )}
        {photos.map((u, i) => {
          const n = i + (videoId ? 2 : 1);
          return (
            <li key={u} className="relative h-full w-full flex-none snap-center" aria-roledescription="slide" aria-label={`Photo, ${n} of ${count}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`${name} — mehndi design photo ${i + 1}`} className="h-full w-full object-cover" loading={n === 1 ? "eager" : "lazy"} decoding="async" draggable={false} />
            </li>
          );
        })}
      </ul>
      {count > 1 && (
        <>
          <button type="button" aria-label="Previous" onClick={() => go(index - 1)} disabled={index === 0} className="absolute top-1/2 left-2 z-10 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-ivory/90 text-plum shadow disabled:opacity-0 sm:grid">
            ‹
          </button>
          <button type="button" aria-label="Next" onClick={() => go(index + 1)} disabled={index === count - 1} className="absolute top-1/2 right-2 z-10 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-ivory/90 text-plum shadow disabled:opacity-0 sm:grid">
            ›
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center gap-1.5" aria-hidden>
            {Array.from({ length: count }, (_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-ivory" : "w-1.5 bg-ivory/55"}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Silent, looping YouTube video that cannot be paused: the player has no controls and a transparent
 * layer on top swallows taps (so swipes still move the carousel). Only an unmute toggle is offered.
 */
function AutoVideo({ id, title }: { id: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(true);
  const [near, setNear] = useState(false);

  // Load the player only when the slide is near the viewport.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const command = (func: string) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");
  function toggle() {
    if (muted) {
      command("unMute");
      command("playVideo");
    } else command("mute");
    setMuted(!muted);
  }

  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    loop: "1",
    playlist: id,
    controls: "0",
    disablekb: "1",
    fs: "0",
    modestbranding: "1",
    playsinline: "1",
    rel: "0",
    iv_load_policy: "3",
    enablejsapi: "1",
  });

  return (
    <div ref={box} className="absolute inset-0 bg-black">
      {near && (
        <iframe
          ref={frame}
          src={`https://www.youtube-nocookie.com/embed/${id}?${params}`}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          className="pointer-events-none absolute top-1/2 left-1/2 h-[130%] w-[130%] -translate-x-1/2 -translate-y-1/2 border-0"
        />
      )}
      {/* Tap shield: keeps the video playing; horizontal swipes still scroll the carousel. */}
      <div className="absolute inset-0" aria-hidden />
      <button
        type="button"
        onClick={toggle}
        aria-pressed={!muted}
        aria-label={muted ? "Unmute video" : "Mute video"}
        className="absolute right-3 bottom-8 z-10 inline-flex min-h-11 items-center gap-2 rounded-full bg-plum-deep/85 px-4 text-sm font-semibold text-ivory shadow-lg ring-1 ring-white/20 backdrop-blur"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 5 6 9H2v6h4l5 4V5Z" />
          {muted ? <path d="m23 9-6 6m0-6 6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
        </svg>
        {muted ? "Tap for sound" : "Mute"}
      </button>
    </div>
  );
}
