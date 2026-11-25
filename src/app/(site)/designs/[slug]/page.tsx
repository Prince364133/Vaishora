import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DesignCard } from "@/components/studio/DesignCard";
import { DesignMedia } from "@/components/studio/DesignMedia";
import { COMPLEXITY_LABEL, StudioDesign } from "@/components/studio/types";
import { cachedDesigns } from "@/server/cached";
import { formatPaise } from "@/lib/money";
import { formatDuration } from "@/lib/time";
import { AdaptiveSkeleton } from "@/components/site/AdaptiveSkeleton";
import type { Metadata } from "next";
import { JsonLd } from "@/components/site/JsonLd";
import { abs, CITY, designDescription, designImage, SITE_NAME } from "@/server/seo";
import { youTubeId, youTubeThumb } from "@/lib/youtube";

async function findDesign(slug: string) {
  const designs = (await cachedDesigns()) as StudioDesign[];
  return { designs, d: designs.find((x) => x.slug === slug) };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { d } = await findDesign(slug);
  if (!d) return { title: "Design not found", robots: { index: false } };
  const title = `${d.name} — ${d.category_name} mehndi design${d.artist_name ? ` by ${d.artist_name}` : ""}`;
  const description = designDescription(d);
  const img = designImage(d);
  const images = img ? [{ url: abs(img), alt: `${d.name} mehndi design` }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: `/designs/${d.slug}` },
    keywords: [`${d.category_name} mehndi`, `${d.name} mehndi design`, `mehndi artist ${CITY}`, "mehndi design price"],
    openGraph: { type: "website", title, description, url: `/designs/${d.slug}`, siteName: SITE_NAME, images },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images: images?.map((i) => i.url) },
  };
}

function designSchema(d: StudioDesign) {
  const url = abs(`/designs/${d.slug}`);
  const images = [...(d.photos ?? []), d.assets.palm_photo, d.assets.back_photo, d.assets.palm, d.assets.back, d.assets.feet].filter((x): x is string => !!x).map(abs);
  const vid = youTubeId(d.video_url);
  const description = designDescription(d);
  return [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      "@id": `${url}#design`,
      name: `${d.name} mehndi design`,
      description,
      image: images,
      category: `${d.category_name} mehndi`,
      brand: { "@type": "Brand", name: SITE_NAME },
      ...(d.artist_name && d.artist_slug ? { creator: { "@type": "Person", name: d.artist_name, url: abs(`/artists/${d.artist_slug}`) } } : {}),
      offers: {
        "@type": "Offer",
        url,
        price: (d.base_price_paise / 100).toFixed(0),
        priceCurrency: "INR",
        availability: d.status === "unavailable" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
        areaServed: { "@type": "City", name: CITY },
        seller: { "@id": abs("/#business") },
      },
      ...(vid
        ? {
            subjectOf: {
              "@type": "VideoObject",
              name: `${d.name} — mehndi design video`,
              description,
              thumbnailUrl: youTubeThumb(vid),
              embedUrl: `https://www.youtube.com/embed/${vid}`,
              contentUrl: `https://www.youtube.com/watch?v=${vid}`,
            },
          }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: abs("/") },
        { "@type": "ListItem", position: 2, name: "Mehndi designs", item: abs("/designs") },
        { "@type": "ListItem", position: 3, name: d.name, item: url },
      ],
    },
  ];
}

const REGION_LABEL = { palm: "Palm", back: "Back of hand", palm_back: "Palm and back", feet: "Feet" } as const;

async function Detail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { designs, d } = await findDesign(slug);
  if (!d) notFound();
  const related = designs.filter((x) => x.slug !== d.slug && (x.category_slug === d.category_slug || x.featured)).slice(0, 4);
  const isFeet = d.region === "feet";
  return (
    <>
      <JsonLd data={designSchema(d)} />
      <nav aria-label="Breadcrumb" className="container-v pt-1 md:pt-4">
        <Link href="/designs" className="link tap-link text-sm">
          All designs
        </Link>
      </nav>
      <div className="container-v grid gap-6 pb-6 md:gap-8 md:pb-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] short-land:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
        <div className="arch relative h-[clamp(260px,52svh,600px)] overflow-hidden bg-plum lg:h-[72svh] lg:max-h-[640px] short-land:sticky short-land:top-[calc(var(--header-h)+8px)] short-land:h-[calc(100svh-var(--header-h)-16px)]">
          <div aria-hidden className="pointer-events-none absolute inset-[7px] arch border border-gold/35" />
          <DesignMedia name={d.name} slug={d.slug} region={d.region} photos={d.photos} videoUrl={d.video_url} assets={d.assets} custom={!!d.artist_name} className="absolute inset-0" />
        </div>
        <div className="lg:pt-4">
          <p className="text-sm font-semibold text-rose-deep">{d.category_name}</p>
          <h1 className="mt-1 text-[2.6rem] md:text-6xl">{d.name}</h1>
          {d.artist_name && d.artist_slug && (
            <p className="mt-2 text-sm">
              By{" "}
              <Link href={`/artists/${d.artist_slug}`} className="link font-semibold">
                {d.artist_name}
              </Link>{" "}
              <span className="text-muted">· booked directly with this artist</span>
            </p>
          )}
          <p className="mt-3 text-base text-muted md:mt-4 md:text-[1.05rem]">{d.description}</p>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y hairline py-5">
            <div>
              <dt className="text-xs text-muted">Price, one {isFeet ? "pair" : "hand"} as shown</dt>
              <dd className="text-2xl font-semibold text-plum">{formatPaise(d.base_price_paise)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Application time</dt>
              <dd className="text-2xl font-semibold text-plum">{formatDuration(d.duration_minutes)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Detail level</dt>
              <dd className="font-semibold">{COMPLEXITY_LABEL[d.complexity]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Artwork for</dt>
              <dd className="font-semibold">{REGION_LABEL[d.region]}</dd>
            </div>
          </dl>
          {d.includes && (
            <p className="mt-3 text-sm">
              <span className="text-muted">Includes:</span> {d.includes}
            </p>
          )}
          <p className="mt-3 text-sm text-muted">Mehndi stains deepen over 24–48 hours; final colour varies with skin and aftercare.</p>
          {d.status === "unavailable" ? (
            <p className="mt-6 font-semibold text-muted">This design is currently unavailable for booking.</p>
          ) : (
            // Phones: sticks to the bottom of the screen while the details are on screen, then rests
            // in place at the end of them. Static from sm up.
            <div className="sticky bottom-[var(--tabbar-h)] z-30 -mx-4 mt-5 flex items-center gap-3 border-t hairline bg-ivory/95 px-4 pt-3 pb-3 backdrop-blur-md sm:static sm:mx-0 sm:mt-6 sm:block sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
              <p className="min-w-0 flex-1 sm:hidden">
                <span className="block text-xs text-muted">From, one {isFeet ? "pair" : "hand"}</span>
                <span className="text-lg font-semibold text-plum">{formatPaise(d.base_price_paise)}</span>
              </p>
              <Link href={`/book/${d.slug}`} className="btn btn-primary flex-none">
                Book this design
              </Link>
            </div>
          )}
        </div>
      </div>
      {related.length > 0 && (
        <section className="container-v pt-4 pb-14 md:pb-16" aria-labelledby="related">
          <h2 id="related" className="text-3xl md:text-4xl">You may also like</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {related.map((r) => (
              <DesignCard key={r.slug} design={r} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export default function DesignPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}
