import { Suspense } from "react";
import type { Metadata } from "next";
import { Catalogue } from "@/components/studio/Catalogue";
import { cachedCategories, cachedDesigns } from "@/server/cached";
import type { StudioDesign } from "@/components/studio/types";

export const metadata: Metadata = {
  title: "Mehndi designs with prices — bridal, Arabic, mandala & more",
  description:
    "Browse mehndi designs by Hyderabad artists — bridal, Arabic, mandala, floral, minimal and more — with photos, 3D previews, prices and application times. Book at home.",
  alternates: { canonical: "/designs" },
  openGraph: { title: "Mehndi designs with prices", url: "/designs" },
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
