import { Suspense } from "react";
import type { Metadata } from "next";
import { Catalogue } from "@/components/studio/Catalogue";
import { cachedCategories, cachedDesigns } from "@/server/cached";
import type { StudioDesign } from "@/components/studio/types";

export const metadata: Metadata = {
  title: "Mehndi designs and prices",
  description: "Browse original mehndi designs — bridal, Arabic, mandala, floral, minimal and more — with prices and application times.",
};

async function List() {
  const [designs, categories] = await Promise.all([cachedDesigns(), cachedCategories()]);
  return <Catalogue designs={designs as StudioDesign[]} categories={categories} />;
}

export default function DesignsPage() {
  return (
    <div className="container-v py-6 md:py-12">
      <h1 className="text-[2.5rem] md:text-6xl">Mehndi designs</h1>
      <p className="mt-2 max-w-2xl text-muted">Prices are for one hand, as shown. Choose both hands, back of hand, feet and extra people when you book.</p>
      <Suspense fallback={<div className="mt-8 h-96 rounded bg-blush/50" />}>
        <List />
      </Suspense>
    </div>
  );
}
