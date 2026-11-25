import Link from "next/link";
import type { PublicArtist } from "@/server/catalog";

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ArtistCard({ artist, className = "" }: { artist: PublicArtist; className?: string }) {
  return (
    <article className={`card flex flex-col overflow-hidden ${className}`}>
      <div className="grid grid-cols-3 gap-px bg-[var(--color-line)]">
        {artist.portfolio.slice(0, 3).map((p, i) => (
          <div key={i} className="aspect-square bg-blush/70">
            <div className="henna-mask h-full w-full" style={{ WebkitMaskImage: `url(${p.image_url})`, maskImage: `url(${p.image_url})` }} role="img" aria-label={p.caption || "Portfolio artwork"} />
          </div>
        ))}
        {artist.portfolio.length === 0 && <div className="col-span-3 aspect-[3/1] bg-blush/70" />}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-3">
          {artist.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={artist.photo_url} alt="" loading="lazy" decoding="async" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-full bg-plum font-display text-lg text-ivory" aria-hidden>
              {initials(artist.name)}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-[1.45rem]">{artist.name}</h3>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {artist.verified && <span className="font-semibold text-success">Verified</span>}
              {artist.is_demo && <span className="sample-badge">Sample profile</span>}
              {artist.rating != null && artist.review_count > 0 && (
                <span className="text-muted">
                  ★ {artist.rating} ({artist.review_count})
                </span>
              )}
            </div>
          </div>
        </div>
        {artist.specialties.length > 0 && <p className="mt-3 text-sm text-plum-ink line-clamp-2">{artist.specialties.slice(0, 4).join(", ")}</p>}
        {artist.experience_years != null && <p className="text-sm text-muted">{artist.experience_years} years of experience</p>}
        {artist.localities.length > 0 && (
          <p className="mt-1 text-sm text-muted line-clamp-1">
            {artist.localities.slice(0, 3).join(", ")}
            {artist.localities.length > 3 ? ` +${artist.localities.length - 3} more` : ""}
          </p>
        )}
        <Link href={`/artists/${artist.slug}`} className="btn btn-secondary btn-sm mt-4">
          View profile
        </Link>
      </div>
    </article>
  );
}
