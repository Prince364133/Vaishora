import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/server/auth";
import { listCategories } from "@/server/catalog";
import { PhotoDesignImporter } from "@/components/admin/PhotoDesignImporter";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";

export const metadata = { title: "Add design from photo" };

async function Content() {
  await connection();
  await requireRole(["admin"]);
  const categories = await listCategories({ includeInactive: true });
  return <PhotoDesignImporter categories={categories.map((c) => ({ slug: c.slug, name: c.name }))} />;
}

export default function FromPhotoPage() {
  return (
    <>
      <Link href="/admin/designs" className="link text-sm">All designs</Link>
      <h1 className="mt-2 text-[2.25rem] sm:text-4xl">Add a design from a photo</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Upload a photo of real mehndi on a hand. We find the hand, fit the photo onto our 3D hand and extract the henna, so the design appears on the 3D
        hand and in the catalogue.
      </p>
      <div className="mt-6">
        <Suspense fallback={<AdaptiveSkeleton />}>
          <Content />
        </Suspense>
      </div>
    </>
  );
}
