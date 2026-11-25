import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireArtist } from "@/server/artist-auth";
import { cachedCategories, cachedSettings } from "@/server/cached";
import { DesignForm } from "@/components/artist/DesignForm";
import { NotActiveNotice, PageHeader } from "@/components/artist/ui";
import { saveArtistDesignAction } from "../../../actions";
import { AdaptiveSkeleton } from "@/components/artist/AdaptiveSkeleton";

export const metadata: Metadata = { title: "Add a design" };

async function NewDesign() {
  await connection();
  const a = await requireArtist();
  const [categories, settings] = await Promise.all([cachedCategories(), cachedSettings()]);
  return (
    <>
      <PageHeader title="Add a design" subtitle="Show customers your real work. Approved designs appear on your profile and in the design catalogue." back={{ href: "/artist-portal/designs", label: "Designs" }} />
      {a.status === "active" ? <DesignForm action={saveArtistDesignAction} categories={categories} /> : <NotActiveNotice status={a.status} phone={settings.support.phone} />}
    </>
  );
}

export default function NewDesignPage() {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <NewDesign />
    </Suspense>
  );
}
