import { Suspense } from "react";
import { connection } from "next/server";
import { DesignStudio } from "@/components/studio/DesignStudio";
import { ArtistShowcase, FinalCta, HowItWorks, PopularDesigns, Services, WhyVaishora } from "@/components/home/Sections";
import { VideoShowcase } from "@/components/videos/VideoShowcase";
import { ReviewsSection } from "@/components/reviews/ReviewsSection";
import { SHOWCASE_VIDEOS, type ShowcaseVideo } from "@/lib/showcase-videos";
import { youTubeId } from "@/lib/youtube";
import { listPublishedReviews, reviewSummary } from "@/server/reviews";
import { cachedArtists, cachedCategories, cachedDesigns } from "@/server/cached";
import { getDb } from "@/server/db";
import type { StudioDesign } from "@/components/studio/types";
import type { Metadata } from "next";
import { JsonLd } from "@/components/site/JsonLd";
import { abs, CITY, SITE_NAME } from "@/server/seo";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { alternates: { canonical: "/" } };

/** Organization + WebSite (sitelinks search) structured data. */
async function SiteSchema() {
  "use cache";
  const s = await getSettings();
  return (
    <JsonLd
      data={[
        {
          "@context": "https://schema.org",
          "@type": "BeautySalon",
          "@id": abs("/#business"),
          name: SITE_NAME,
          url: abs("/"),
          logo: abs("/brand/emblem.png"),
          image: abs("/opengraph-image"),
          description: `Book a verified mehndi artist at home in ${CITY}: bridal, Arabic, mandala and minimal mehndi with transparent prices.`,
          areaServed: { "@type": "City", name: CITY },
          address: { "@type": "PostalAddress", addressLocality: CITY, addressRegion: "Telangana", addressCountry: "IN" },
          priceRange: "₹₹",
          ...(s.support.phone ? { telephone: s.support.phone } : {}),
          ...(s.support.email ? { email: s.support.email } : {}),
        },
        {
          "@context": "https://schema.org",
          "@type": "WebSite",
          "@id": abs("/#website"),
          name: SITE_NAME,
          url: abs("/"),
          inLanguage: "en-IN",
          publisher: { "@id": abs("/#business") },
        },
      ]}
    />
  );
}

async function Studio() {
  const [designs, categories] = await Promise.all([cachedDesigns(), cachedCategories()]);
  return <DesignStudio designs={designs as StudioDesign[]} categories={categories} />;
}

async function CatalogueSections() {
  const designs = (await cachedDesigns()) as StudioDesign[];
  return (
    <>
      <PopularDesigns designs={designs} />
      <Services designs={designs} />
    </>
  );
}

/** Real VAISHORA work first: videos artists attached to their approved designs; curated videos only until those exist. */
async function Videos() {
  const designs = (await cachedDesigns()) as StudioDesign[];
  const own: ShowcaseVideo[] = designs.flatMap((d) => {
    const id = youTubeId(d.video_url);
    return id && d.artist_name
      ? [{ platform: "youtube" as const, ref: id, url: `https://www.youtube.com/watch?v=${id}`, title: d.name, creator: d.artist_name, creatorUrl: d.artist_slug ? `/artists/${d.artist_slug}` : undefined, ownWork: true }]
      : [];
  });
  return <VideoShowcase videos={own.length ? own.slice(0, 12) : SHOWCASE_VIDEOS} />;
}

async function Artists() {
  const artists = await cachedArtists();
  return <ArtistShowcase artists={artists} />;
}

async function Reviews() {
  await connection();
  const db = await getDb();
  const [reviews, summary] = await Promise.all([listPublishedReviews(9, db), reviewSummary(db)]);
  return <ReviewsSection reviews={reviews} summary={summary} />;
}

function StudioSkeleton() {
  return (
    <div className="container-v grid gap-8 py-10 lg:grid-cols-2" aria-hidden>
      <div className="space-y-4 pt-8">
        <div className="h-5 w-48 rounded bg-blush" />
        <div className="h-28 w-full max-w-lg rounded bg-blush" />
        <div className="h-12 w-72 rounded bg-blush" />
      </div>
      <div className="arch h-[46svh] bg-plum lg:h-[70svh]" />
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <Suspense fallback={null}>
        <SiteSchema />
      </Suspense>
      <Suspense fallback={<StudioSkeleton />}>
        <Studio />
      </Suspense>
      <Suspense fallback={<div className="h-96" />}>
        <CatalogueSections />
      </Suspense>
      <Suspense fallback={<VideoShowcase videos={SHOWCASE_VIDEOS} />}>
        <Videos />
      </Suspense>
      <HowItWorks />
      <WhyVaishora />
      <Suspense fallback={<div className="h-96" />}>
        <Artists />
      </Suspense>
      <Suspense fallback={null}>
        <Reviews />
      </Suspense>
      <FinalCta />
    </>
  );
}
