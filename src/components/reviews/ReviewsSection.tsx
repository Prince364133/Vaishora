import type { PublicReview } from "@/server/reviews";

const SOURCE_LABEL: Record<string, string> = {
  booking: "Verified VAISHORA booking",
  google: "Google review",
  whatsapp: "Shared on WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  other: "Customer review",
};

function Stars({ value }: { value: number }) {
  return (
    <span className="text-gold" aria-label={`${value} out of 5 stars`}>
      {"★★★★★".slice(0, value)}
      <span className="text-gold/30">{"★★★★★".slice(value)}</span>
    </span>
  );
}

/**
 * Real reviews only: customers reviewing completed bookings, or reviews the business received
 * elsewhere and recorded by an admin with a link/evidence. Nothing renders when there are none.
 */
export function ReviewsSection({ reviews, summary }: { reviews: PublicReview[]; summary: { count: number; average: number | null } }) {
  if (!reviews.length) return null;
  return (
    <section className="bg-blush/55 py-14 md:py-24" aria-labelledby="reviews-title">
      <div className="container-v">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="reviews-title" className="text-4xl md:text-5xl">
            What customers say
          </h2>
          {summary.average != null && (
            <p className="text-sm text-muted">
              <Stars value={Math.round(summary.average)} /> {summary.average} from {summary.count} review{summary.count === 1 ? "" : "s"}
            </p>
          )}
        </div>
        <div className="scroller scroller-bleed mt-8 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
          {reviews.map((r) => (
            <figure key={r.id} className="card flex w-[min(85%,340px)] flex-col p-5 sm:w-auto">
              <Stars value={r.rating} />
              <blockquote className="mt-3 flex-1 text-[0.98rem] leading-relaxed text-plum-ink">“{r.body}”</blockquote>
              <figcaption className="mt-4 text-sm">
                <span className="font-semibold">{r.name}</span>
                <span className="text-muted"> · {r.date}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {r.source_url ? (
                    <a href={r.source_url} target="_blank" rel="noopener nofollow" className="link">
                      {SOURCE_LABEL[r.source] ?? r.source}
                    </a>
                  ) : (
                    SOURCE_LABEL[r.source] ?? r.source
                  )}
                  {r.source === "booking" && r.context ? ` · ${r.context}` : ""}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
