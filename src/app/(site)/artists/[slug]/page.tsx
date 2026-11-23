import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cachedArtists } from "@/server/cached";
import { initials } from "@/components/artists/ArtistCard";

async function Profile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = (await cachedArtists()).find((x) => x.slug === slug);
  if (!a) notFound();
  return (
    <div className="container-v max-w-4xl pt-1 pb-12 md:py-12">
      <Link href="/artists" className="link tap-link text-sm">All artists</Link>
      <div className="mt-3 flex items-start gap-4 sm:items-center">
        {a.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.photo_url} alt="" className="h-16 w-16 flex-none rounded-full object-cover sm:h-20 sm:w-20" />
        ) : (
          <span className="grid h-16 w-16 flex-none place-items-center rounded-full bg-plum font-display text-2xl text-ivory sm:h-20 sm:w-20 sm:text-3xl" aria-hidden>{initials(a.name)}</span>
        )}
        <div className="min-w-0">
          <h1 className="text-[2.3rem] md:text-5xl">{a.name}</h1>
          <div className="mt-1.5 flex flex-wrap gap-2 text-sm">
            {a.verified && <span className="font-semibold text-success">Verified by VAISHORA</span>}
            {a.is_demo && <span className="sample-badge rounded-[var(--radius-sm)] py-1">Sample profile for development — not a real artist</span>}
            {a.rating != null && a.review_count > 0 && <span className="text-muted">★ {a.rating} from {a.review_count} reviews</span>}
          </div>
        </div>
      </div>
      {a.bio && <p className="mt-5 max-w-2xl text-base text-muted md:mt-6 md:text-[1.05rem]">{a.bio}</p>}
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
        {a.specialties.length > 0 && <div><dt className="text-muted">Specialties</dt><dd>{a.specialties.join(", ")}</dd></div>}
        {a.experience_years != null && <div><dt className="text-muted">Experience</dt><dd>{a.experience_years} years (verified)</dd></div>}
        {a.localities.length > 0 && <div><dt className="text-muted">Serves</dt><dd>{a.localities.join(", ")}</dd></div>}
      </dl>
      {a.portfolio.length > 0 && (
        <section className="mt-10">
          <h2 className="text-3xl">Portfolio</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {a.portfolio.map((p, i) =>
              p.image_url.endsWith(".svg") ? (
                <div key={i} className="aspect-square rounded-[var(--radius-md)] bg-blush/70"><div className="henna-mask h-full w-full" style={{ WebkitMaskImage: `url(${p.image_url})`, maskImage: `url(${p.image_url})` }} role="img" aria-label={p.caption || "Portfolio artwork"} /></div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={p.image_url} alt={p.caption || `${a.name} portfolio`} className="aspect-square w-full rounded-[var(--radius-md)] object-cover" />
              ),
            )}
          </div>
        </section>
      )}
      <div className="mt-10 card p-5">
        <p className="font-semibold">Booking with {a.name.split(" ")[0]}</p>
        <p className="mt-1 text-sm text-muted">Choose a design and time; we assign an available artist serving your area. Requests for a specific artist can be added in “Special requirements”.</p>
        <Link href="/designs" className="btn btn-primary mt-4 w-full sm:w-auto">Choose a design</Link>
      </div>
    </div>
  );
}

export default function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<div className="container-v py-16 text-muted">Loading…</div>}>
      <Profile params={params} />
    </Suspense>
  );
}
