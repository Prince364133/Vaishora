import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cachedArtists, cachedDesigns } from "@/server/cached";
import { abs, CITY, clip, designImage, SITE_NAME } from "@/server/seo";
import { DesignCard } from "@/components/studio/DesignCard";
import type { StudioDesign } from "@/components/studio/types";
import { initials } from "@/components/artists/ArtistCard";
import { ProfileTabs } from "@/components/artists/ProfileTabs";
import { JsonLd } from "@/components/site/JsonLd";
import { AdaptiveSkeleton } from "@/components/site/AdaptiveSkeleton";

type Params = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const [artists, allDesigns] = await Promise.all([cachedArtists(), cachedDesigns()]);
  const a = artists.find((x) => x.slug === slug);
  if (!a) return null;
  const designs = (allDesigns as StudioDesign[]).filter((d) => d.artist_slug === a.slug && d.status === "active");
  return { a, designs };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) return { title: "Artist not found", robots: { index: false } };
  const { a, designs } = data;
  const title = `${a.name} — mehndi artist in ${CITY}`;
  const description = clip(
    a.bio ||
      `${a.name} is a ${a.verified ? "verified " : ""}mehndi artist in ${CITY}${a.specialties.length ? ` for ${a.specialties.slice(0, 4).join(", ").toLowerCase()} mehndi` : ""}${a.localities.length ? `, serving ${a.localities.slice(0, 5).join(", ")}` : ""}. See designs and portfolio and book at home.`,
  );
  const image = a.photo_url ?? designs.map((d) => designImage(d)).find(Boolean) ?? a.portfolio[0]?.image_url ?? null;
  return {
    title,
    description,
    alternates: { canonical: `/artists/${a.slug}` },
    robots: a.is_demo ? { index: false, follow: false } : undefined,
    openGraph: { type: "profile", title, description, url: `/artists/${a.slug}`, siteName: SITE_NAME, images: image ? [{ url: abs(image), alt: `${a.name}, mehndi artist` }] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [abs(image)] : undefined },
  };
}

async function Profile({ params }: Params) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { a, designs } = data;
  const first = a.name.split(" ")[0];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": abs(`/artists/${a.slug}#artist`),
    name: `${a.name} — mehndi artist`,
    url: abs(`/artists/${a.slug}`),
    image: a.photo_url ? abs(a.photo_url) : undefined,
    description: a.bio || undefined,
    areaServed: a.localities.map((l) => ({ "@type": "Place", name: `${l}, ${CITY}` })),
    knowsAbout: a.specialties.map((s) => `${s} mehndi`),
    ...(a.rating != null && a.review_count > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: a.rating, reviewCount: a.review_count } } : {}),
    hasOfferCatalog: designs.length
      ? {
          "@type": "OfferCatalog",
          name: `Mehndi designs by ${a.name}`,
          itemListElement: designs.map((d) => ({
            "@type": "Offer",
            url: abs(`/designs/${d.slug}`),
            price: (d.base_price_paise / 100).toFixed(0),
            priceCurrency: "INR",
            itemOffered: { "@type": "Service", name: d.name, image: designImage(d) ? abs(designImage(d)!) : undefined },
          })),
        }
      : undefined,
    subjectOf: a.portfolio.filter((p) => !p.image_url.endsWith(".svg")).map((p) => ({ "@type": "ImageObject", contentUrl: abs(p.image_url), caption: p.caption || `Mehndi by ${a.name}` })),
  };

  return (
    <div className="container-v max-w-4xl pt-1 pb-12 md:py-12">
      <JsonLd data={jsonLd} />
      <nav aria-label="Breadcrumb">
        <Link href="/artists" className="link tap-link text-sm">
          All artists
        </Link>
      </nav>
      <div className="mt-3 flex items-start gap-4 sm:items-center">
        {a.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.photo_url} alt={`${a.name}, mehndi artist in ${CITY}`} className="h-16 w-16 flex-none rounded-full object-cover sm:h-20 sm:w-20" />
        ) : (
          <span className="grid h-16 w-16 flex-none place-items-center rounded-full bg-plum font-display text-2xl text-ivory sm:h-20 sm:w-20 sm:text-3xl" aria-hidden>
            {initials(a.name)}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-[2.3rem] md:text-5xl">{a.name}</h1>
          <div className="mt-1.5 flex flex-wrap gap-2 text-sm">
            {a.verified && <span className="font-semibold text-success">Verified by VAISHORA</span>}
            {a.is_demo && <span className="sample-badge rounded-[var(--radius-sm)] py-1">Sample profile for development — not a real artist</span>}
            {a.rating != null && a.review_count > 0 && (
              <span className="text-muted">
                ★ {a.rating} from {a.review_count} reviews
              </span>
            )}
          </div>
        </div>
      </div>
      {a.bio && <p className="mt-5 max-w-2xl text-base text-muted md:mt-6 md:text-[1.05rem]">{a.bio}</p>}
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
        {a.specialties.length > 0 && (
          <div>
            <dt className="text-muted">Specialties</dt>
            <dd>{a.specialties.join(", ")}</dd>
          </div>
        )}
        {a.experience_years != null && (
          <div>
            <dt className="text-muted">Experience</dt>
            <dd>{a.experience_years} years (verified)</dd>
          </div>
        )}
        {a.localities.length > 0 && (
          <div>
            <dt className="text-muted">Serves</dt>
            <dd>{a.localities.join(", ")}</dd>
          </div>
        )}
      </dl>

      <ProfileTabs
        designCount={designs.length}
        portfolioCount={a.portfolio.length}
        designs={
          designs.length ? (
            <>
              <p className="mb-4 text-sm text-muted">Book any design to see the times {first} is free in your area.</p>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                {designs.map((d) => (
                  <DesignCard key={d.id} design={d} />
                ))}
              </div>
            </>
          ) : (
            <div className="card p-6 text-center">
              <p className="text-muted">{first} hasn’t listed designs yet. You can still book any VAISHORA design — we assign an available artist in your area.</p>
              <Link href="/designs" className="btn btn-primary mt-4">
                Browse designs
              </Link>
            </div>
          )
        }
        portfolio={
          a.portfolio.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {a.portfolio.map((p, i) =>
                p.image_url.endsWith(".svg") ? (
                  <div key={i} className="aspect-square rounded-[var(--radius-md)] bg-blush/70">
                    <div className="henna-mask h-full w-full" style={{ WebkitMaskImage: `url(${p.image_url})`, maskImage: `url(${p.image_url})` }} role="img" aria-label={p.caption || "Portfolio artwork"} />
                  </div>
                ) : (
                  <figure key={i}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image_url} alt={p.caption || `Mehndi by ${a.name}, ${CITY} — portfolio photo ${i + 1}`} loading="lazy" decoding="async" className="aspect-square w-full rounded-[var(--radius-md)] object-cover" />
                    {p.caption && <figcaption className="mt-1 text-xs text-muted">{p.caption}</figcaption>}
                  </figure>
                ),
              )}
            </div>
          ) : (
            <p className="card p-6 text-center text-muted">No portfolio photos yet.</p>
          )
        }
      />
    </div>
  );
}

export default function ArtistPage({ params }: Params) {
  return (
    <Suspense fallback={<AdaptiveSkeleton variant="profile" />}>
      <Profile params={params} />
    </Suspense>
  );
}
