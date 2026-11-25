import Link from "next/link";
import { HandIllustration } from "@/components/hand/HandIllustration";
import { formatPaise } from "@/lib/money";
import { formatDuration } from "@/lib/time";
import { previewArt, previewSide, StudioDesign } from "./types";

/** Grid card used in "Popular designs" and the catalogue. The whole card is one tap target. */
export function DesignCard({ design, priority = false }: { design: StudioDesign; priority?: boolean }) {
  void priority;
  const unavailable = design.status === "unavailable";
  return (
    <article className="group card relative flex flex-col overflow-hidden transition-[border-color] hover:border-rose has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-plum has-[a:focus-visible]:ring-offset-2">
      <div className="overflow-hidden bg-blush/60">
        {design.photos?.length ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={design.photos[0]} alt={`${design.name} — ${design.category_name} mehndi design`} loading="lazy" decoding="async" className="aspect-[4/5] w-full object-cover transition-transform duration-500 ease-[var(--ease-out-soft)] group-hover:scale-[1.03]" />
        ) : (
          <HandIllustration side={previewSide(design)} art={previewArt(design)} className="mx-auto w-[86%] transition-transform duration-500 ease-[var(--ease-out-soft)] group-hover:scale-[1.03]" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-3 sm:gap-1 sm:p-4">
        <p className="text-xs font-semibold text-rose-deep">
          {design.category_name}
          {design.artist_name ? <span className="font-normal text-muted"> · by {design.artist_name}</span> : null}
        </p>
        <h3 className="text-[1.2rem] leading-tight sm:text-[1.45rem]">
          <Link href={`/designs/${design.slug}`} className="stretched-link focus-visible:outline-none">
            {design.name}
          </Link>
        </h3>
        <p className="text-[0.8125rem] text-muted sm:text-sm">{formatDuration(design.duration_minutes)} per hand</p>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-1 pt-2 sm:pt-3">
          <p>
            <span className="block text-xs text-muted">One hand, as shown</span>
            <span className="text-lg font-semibold text-plum">{formatPaise(design.base_price_paise)}</span>
          </p>
          {unavailable ? (
            <span className="text-xs text-muted sm:text-sm">Currently unavailable</span>
          ) : (
            <span aria-hidden className="btn btn-secondary btn-sm hidden sm:inline-flex">
              View design
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
