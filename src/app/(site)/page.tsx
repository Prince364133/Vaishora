import { Suspense } from "react";
import { connection } from "next/server";
import { DesignStudio } from "@/components/studio/DesignStudio";
import { ArtistShowcase, FinalCta, HowItWorks, PopularDesigns, Services, WhyVaishora } from "@/components/home/Sections";
import { VideoShowcase } from "@/components/videos/VideoShowcase";
import { ReviewsSection } from "@/components/reviews/ReviewsSection";
import { SHOWCASE_VIDEOS } from "@/lib/showcase-videos";
import { listPublishedReviews, reviewSummary } from "@/server/reviews";
import { cachedArtists, cachedCategories, cachedDesigns } from "@/server/cached";
import { getDb } from "@/server/db";
import type { StudioDesign } from "@/components/studio/types";

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
      <Suspense fallback={<StudioSkeleton />}>
        <Studio />
      </Suspense>
      <Suspense fallback={<div className="h-96" />}>
        <CatalogueSections />
      </Suspense>
      <VideoShowcase videos={SHOWCASE_VIDEOS} />
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
