"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LazyHandViewer3D as HandViewer3D } from "@/components/hand/LazyHandViewer3D";
import { HandIllustration } from "@/components/hand/HandIllustration";
import { formatPaise } from "@/lib/money";
import { formatDuration } from "@/lib/time";
import { COMPLEXITY_LABEL, previewArt, previewSide, StudioCategory, StudioDesign } from "./types";

interface Props {
  designs: StudioDesign[];
  categories: StudioCategory[];
  initialSlug?: string;
}

/**
 * Hero + interactive design studio. One WebGL viewer is shared by both: the hero
 * introduces the hand, the studio below it changes the mehndi on that same hand.
 */
export function DesignStudio({ designs, categories, initialSlug }: Props) {
  const [category, setCategory] = useState<string>("all");
  const [slug, setSlug] = useState<string>(initialSlug ?? designs.find((d) => d.featured && d.region !== "feet")?.slug ?? designs[0]?.slug);
  const selected = designs.find((d) => d.slug === slug) ?? designs[0];
  const scroller = useRef<HTMLDivElement>(null);
  const [studioInView, setStudioInView] = useState(false);
  const [heroCtaInView, setHeroCtaInView] = useState(true);
  const section = useRef<HTMLElement>(null);
  const heroCta = useRef<HTMLDivElement>(null);

  const usedCategories = useMemo(() => categories.filter((c) => designs.some((d) => d.category_slug === c.slug)), [categories, designs]);
  const visible = useMemo(() => (category === "all" ? designs : designs.filter((d) => d.category_slug === category)), [designs, category]);

  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStudioInView(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    // The mobile booking bar only appears once the hero's own buttons have scrolled away, so it
    // never covers the hand's controls on the first screen.
    const cta = heroCta.current;
    const ctaIo = new IntersectionObserver(([e]) => setHeroCtaInView(e.isIntersecting));
    if (cta) ctaIo.observe(cta);
    return () => {
      io.disconnect();
      ctaIo.disconnect();
    };
  }, []);

  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>(`[data-slug="${slug}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [slug, category]);

  if (!selected) {
    return (
      <section className="container-v py-24 text-center">
        <h1 className="text-4xl">Designs are being prepared</h1>
        <p className="mt-3 text-muted">Our design library will appear here shortly.</p>
      </section>
    );
  }

  const palmArt = selected.region === "feet" ? selected.assets.feet ?? null : selected.assets.palm ?? null;
  const backArt = selected.region === "feet" ? null : selected.assets.back ?? null;
  const unavailable = selected.status === "unavailable";

  return (
    <section ref={section} id="studio" aria-label="Design studio" className="relative pb-[calc(76px+env(safe-area-inset-bottom))] sm:pb-0">
      <div className="container-v grid grid-cols-[minmax(0,1fr)] gap-x-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:py-10 short-land:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] short-land:gap-x-6">
        {/* Hero copy */}
        <div className="pt-5 pb-4 sm:pt-7 sm:pb-5 lg:pt-14 lg:pb-8 lg:col-start-1 short-land:col-start-1 short-land:pt-4">
          <p className="eyebrow text-[1.05rem] sm:text-[1.15rem]">Mehndi artists in Hyderabad</p>
          <h1 className="mt-1.5 text-[clamp(2.25rem,10.5vw,2.75rem)] leading-[1.02] sm:mt-2 sm:text-6xl lg:text-[4.4rem] short-land:text-[2.5rem]">
            Your mehndi. Your style. Your artist.
          </h1>
          <p className="mt-3 max-w-[34rem] text-base text-muted sm:mt-4 sm:text-[1.05rem]">
            Discover beautiful mehndi designs, explore them in 3D, and book talented artists for your special moments.
          </p>
          <div ref={heroCta} className="mt-5 grid grid-cols-2 gap-2.5 min-[400px]:flex min-[400px]:flex-wrap min-[400px]:gap-3 sm:mt-6">
            <a href="#designs-carousel" className="btn btn-primary px-3 min-[400px]:px-[1.4rem]">
              Explore designs
            </a>
            <Link href={`/book/${selected.slug}`} className="btn btn-secondary px-3 min-[400px]:px-[1.4rem]">
              Book an artist
            </Link>
          </div>
        </div>

        {/* 3D stage — sticky on mobile while browsing designs, sticky column on desktop */}
        {/* Height scales with the screen (~38% of a phone, never under 210px) so the design cards
            stay visible beneath it while it is pinned; phones held sideways get a side column. */}
        <div
          className="sticky z-20 -mx-4 bg-ivory px-4 pb-2 sm:mx-0 sm:px-0 lg:row-span-3 lg:col-start-2 lg:row-start-1 lg:self-start lg:pb-0 short-land:row-span-3 short-land:col-start-2 short-land:row-start-1 short-land:self-start short-land:pb-0 short-land:pt-2"
          style={{ top: "var(--header-h)" }}
        >
          <div className="arch relative mx-auto overflow-hidden bg-plum h-[clamp(210px,38svh,380px)] md:h-[min(44svh,460px)] lg:h-[calc(100svh-var(--header-h)-48px)] lg:max-h-[760px] lg:mt-6 short-land:h-[calc(100svh-var(--header-h)-16px)]">
            <div aria-hidden className="pointer-events-none absolute inset-[7px] arch border border-gold/35" />
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(212,132,166,0.22),transparent_62%)]" />
            <HandViewer3D
              palmArt={palmArt}
              backArt={backArt}
              region={selected.region}
              designName={selected.name}
              designSlug={selected.slug}
              palmPhoto={selected.assets.palm_photo ?? null}
              backPhoto={selected.assets.back_photo ?? null}
              customOnly={!!selected.artist_name}
              modelFront={selected.assets.model_front ?? null}
              modelBack={selected.assets.model_back ?? null}
              className="absolute inset-0 pt-6"
            />
          </div>
        </div>

        {/* Studio controls */}
        <div className="lg:col-start-1 pb-2 sm:pb-8 short-land:col-start-1">
          <div id="designs-carousel" className="pt-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-[1.75rem] sm:text-[1.9rem]">Choose a design</h2>
              <Link href="/designs" className="link tap-link text-sm whitespace-nowrap">
                All designs
              </Link>
            </div>
            <div className="scroller scroller-bleed mt-2 pb-1" role="radiogroup" aria-label="Design category">
              <button type="button" role="radio" aria-checked={category === "all"} className="chip" onClick={() => setCategory("all")}>
                All
              </button>
              {usedCategories.map((c) => (
                <button key={c.slug} type="button" role="radio" aria-checked={category === c.slug} className="chip" onClick={() => setCategory(c.slug)}>
                  {c.name}
                </button>
              ))}
            </div>

            <div ref={scroller} className="scroller scroller-bleed mt-3 pb-2" role="radiogroup" aria-label="Mehndi designs">
              {visible.map((d) => {
                const active = d.slug === selected.slug;
                return (
                  <button
                    key={d.slug}
                    data-slug={d.slug}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSlug(d.slug)}
                    className={`w-[clamp(124px,36vw,148px)] rounded-[var(--radius-md)] border bg-white p-2 text-left transition-[border-color,box-shadow] ${
                      active ? "border-plum shadow-[0_0_0_1px_var(--color-plum)]" : "hairline hover:border-rose"
                    }`}
                  >
                    <div className="rounded-[6px] bg-blush/70">
                      <HandIllustration side={previewSide(d)} art={previewArt(d)} />
                    </div>
                    <p className="mt-2 text-xs font-semibold text-rose-deep">{d.category_name}</p>
                    <p className="text-sm font-semibold leading-snug text-plum-ink line-clamp-1">{d.name}</p>
                    <p className="text-sm text-muted">{formatPaise(d.base_price_paise)}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected design details */}
          <div className="mt-5 border-t hairline pt-5" aria-live="polite">
            <p className="text-sm font-semibold text-rose-deep">
              {selected.category_name}
              {COMPLEXITY_LABEL[selected.complexity] !== selected.category_name && <> · {COMPLEXITY_LABEL[selected.complexity]}</>}
            </p>
            <h3 className="mt-1 text-[1.9rem] sm:text-[2.1rem]">{selected.name}</h3>
            <p className="mt-2 max-w-[36rem] text-muted">{selected.description}</p>
            <dl className="mt-4 grid grid-cols-2 gap-4 max-w-md">
              <div>
                <dt className="text-xs text-muted">Price, one hand as shown</dt>
                <dd className="text-2xl font-semibold text-plum">{formatPaise(selected.base_price_paise)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Application time</dt>
                <dd className="text-2xl font-semibold text-plum">{formatDuration(selected.duration_minutes)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted">Both hands, back of hand, feet and extra people are priced on the next step.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {unavailable ? (
                <p className="text-muted">This design is currently unavailable for booking.</p>
              ) : (
                // On phones the booking bar at the bottom of the screen carries this action.
                <Link href={`/book/${selected.slug}`} className="btn btn-primary hidden sm:inline-flex">
                  Book this design
                </Link>
              )}
              <Link href={`/designs/${selected.slug}`} className="btn btn-secondary w-full sm:w-auto sm:border-transparent">
                Design details
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile booking bar */}
      <div
        className={`fixed inset-x-0 bottom-[var(--tabbar-h)] z-30 border-t hairline bg-ivory/95 backdrop-blur-md transition-transform duration-300 sm:hidden ${
          studioInView && !heroCtaInView ? "translate-y-0" : "pointer-events-none translate-y-full"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="container-v flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-plum-ink">{selected.name}</p>
            <p className="text-sm text-muted">{formatPaise(selected.base_price_paise)} · {formatDuration(selected.duration_minutes)}</p>
          </div>
          {unavailable ? (
            <span className="text-sm text-muted">Unavailable</span>
          ) : (
            <Link href={`/book/${selected.slug}`} className="btn btn-primary flex-none gap-0 px-4 min-[360px]:px-5" aria-label={`Book ${selected.name}`}>
              Book<span className="hidden min-[360px]:inline">&nbsp;this design</span>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
