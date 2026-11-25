"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { embedUrl, PLATFORM_LABEL, ShowcaseVideo, thumbnailUrl } from "@/lib/showcase-videos";

/**
 * One row of vertical videos. The section is taller than the screen and its row is sticky:
 * scrolling down the page moves through the videos one by one, centring and playing the active
 * one (muted) while the others show a still. Tapping a card jumps to it. YouTube videos also
 * advance automatically when they finish. Only the active video is mounted, so the page never
 * runs more than one player at a time.
 */
export function VideoShowcase({ videos }: { videos: ShowcaseVideo[] }) {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const swipeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Horizontal swipes on the row also choose the playing video (card nearest the centre).
  const onTrackScroll = () => {
    if (swipeTimer.current) clearTimeout(swipeTimer.current);
    swipeTimer.current = setTimeout(() => {
      const t = track.current;
      if (!t) return;
      const mid = t.scrollLeft + t.clientWidth / 2;
      let best = 0;
      let dist = Infinity;
      Array.from(t.children).forEach((c, i) => {
        const el = c as HTMLElement;
        const d = Math.abs(el.offsetLeft + el.clientWidth / 2 - mid);
        if (d < dist) {
          dist = d;
          best = i;
        }
      });
      setActive((cur) => (cur === best ? cur : best));
    }, 160);
  };
  const [active, setActive] = useState(0);
  const [inView, setInView] = useState(false);
  const [reduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const n = videos.length;

  // Scroll progress through the tall section selects the active video.
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const travel = r.height - window.innerHeight;
        const progress = travel > 0 ? Math.min(1, Math.max(0, -r.top / travel)) : 0;
        setActive(Math.min(n - 1, Math.floor(progress * n * 0.9999)));
        setInView(r.top < window.innerHeight * 0.6 && r.bottom > window.innerHeight * 0.4);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [n]);

  // Keep the active card centred in the row.
  useEffect(() => {
    const t = track.current;
    const card = t?.children[active] as HTMLElement | undefined;
    if (!t || !card) return;
    t.scrollTo({ left: card.offsetLeft - (t.clientWidth - card.clientWidth) / 2, behavior: reduced ? "auto" : "smooth" });
  }, [active, reduced]);

  /** Scroll the page so that video `i` becomes active. */
  const goTo = useCallback(
    (i: number) => {
      const el = section.current;
      if (!el) return;
      const travel = el.offsetHeight - window.innerHeight;
      const top = el.getBoundingClientRect().top + window.scrollY + ((i + 0.5) / n) * travel;
      window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    },
    [n, reduced],
  );

  // YouTube: listen for "ended" (state 0) and advance to the next video.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname)) return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        const state = data?.info?.playerState ?? (data?.event === "onStateChange" ? data.info : undefined);
        if (state === 0 && active < n - 1) goTo(active + 1);
      } catch {
        /* ignore non-JSON messages */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [active, n, goTo]);

  return (
    <section ref={section} aria-labelledby="videos-title" className="relative h-[calc(var(--n)*50svh)] bg-plum text-blush md:h-[calc(var(--n)*75svh)]" style={{ ["--n" as string]: Math.max(2, n) }}>
      <div className="sticky top-[var(--header-h)] flex h-[calc(100svh-var(--header-h))] flex-col justify-center overflow-hidden py-6">
        <div className="container-v">
          <h2 id="videos-title" className="text-3xl text-ivory md:text-5xl">
            Real mehndi, real hands
          </h2>
          <p className="mt-1 max-w-xl text-sm text-blush/80 md:text-base">
            Scroll to play. Mehndi videos from artists across India — each video belongs to its creator, credited below.
          </p>
        </div>

        <div
          ref={track}
          onScroll={onTrackScroll}
          className="mt-5 flex min-h-0 flex-1 items-center gap-4 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] px-[18vw] md:gap-6 md:px-[calc(50vw-150px)]"
          role="list"
          aria-label="Mehndi videos"
        >
          {videos.map((v, i) => {
            const isActive = i === active;
            const thumb = thumbnailUrl(v);
            return (
              <figure
                key={v.url}
                role="listitem"
                className={`relative flex h-full snap-center max-h-[min(56svh,560px)] md:max-h-[min(66svh,560px)] flex-none flex-col transition-[transform,opacity] duration-500 ease-[var(--ease-out-soft)] ${
                  isActive ? "scale-100 opacity-100" : "scale-[0.86] opacity-55"
                }`}
                style={{ aspectRatio: "9 / 16" }}
              >
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--radius-lg)] bg-plum-deep ring-1 ring-gold/30">
                  {isActive && inView && thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                  )}
                  {isActive && inView ? (
                    <iframe
                      key={`${v.url}-playing`}
                      src={embedUrl(v, { autoplay: true })}
                      title={`${v.title} — video by ${v.creator} on ${PLATFORM_LABEL[v.platform]}`}
                      className="absolute inset-0 h-full w-full"
                      allow="autoplay; encrypted-media; picture-in-picture; web-share"
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="strict-origin-when-cross-origin"
                      onLoad={(e) => {
                        // Ask the YouTube player to send state events (used for auto-advance).
                        if (v.platform === "youtube") e.currentTarget.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: i }), "*");
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => goTo(i)}
                      className="absolute inset-0 flex h-full w-full items-center justify-center"
                      aria-label={`Play ${v.title} by ${v.creator}`}
                    >
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(212,132,166,0.35),transparent_65%)]" />
                      )}
                      <span className="relative grid h-14 w-14 place-items-center rounded-full bg-ivory/90 text-plum shadow-lg">
                        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden fill="currentColor"><path d="M6 4l10 6-10 6z" /></svg>
                      </span>
                      {!thumb && <span className="absolute bottom-4 text-sm font-semibold text-ivory">{PLATFORM_LABEL[v.platform]}</span>}
                    </button>
                  )}
                </div>
                <figcaption className="mt-2 text-xs text-blush/80">
                  {v.creatorUrl ? (
                    <a href={v.creatorUrl} target="_blank" rel="noopener nofollow" className="inline-flex min-h-11 items-center underline decoration-rose/60 underline-offset-2 hover:text-ivory">
                      {v.creator}
                    </a>
                  ) : (
                    <a href={v.url} target="_blank" rel="noopener nofollow" className="inline-flex min-h-11 items-center underline decoration-rose/60 underline-offset-2 hover:text-ivory">
                      {v.creator}
                    </a>
                  )}{" "}
                  · {PLATFORM_LABEL[v.platform]}
                </figcaption>
              </figure>
            );
          })}
        </div>

        <div className="mt-3 flex justify-center gap-2" role="tablist" aria-label="Choose video">
          {videos.map((v, i) => (
            <button
              key={v.url}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Video ${i + 1} of ${n}: ${v.title}`}
              onClick={() => goTo(i)}
              className="grid h-11 w-8 place-items-center"
            >
              <span className={`block h-1.5 rounded-full transition-all ${i === active ? "w-6 bg-gold" : "w-1.5 bg-blush/40"}`} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
