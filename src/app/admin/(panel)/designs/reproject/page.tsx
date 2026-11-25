import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { ReprojectTool, type ReprojectItem } from "@/components/admin/ReprojectTool";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";

export const metadata = { title: "Rebuild photo designs" };

async function Content() {
  await connection();
  await requireRole(["admin"]);
  const db = await getDb();
  // Latest capture run of every photo design (one per design side).
  const rows = await db.query<ReprojectItem>(
    `SELECT DISTINCT ON (s.id) r.id AS run_id, d.name, d.slug, s.side, s.photo_url, r.edits_url, r.landmarks, r.params, r.frame_version
       FROM capture_sources s
       JOIN designs d ON d.id = s.design_id
       JOIN capture_runs r ON r.source_id = s.id
      ORDER BY s.id, r.created_at DESC`,
  );
  return <ReprojectTool items={rows} />;
}

export default function ReprojectPage() {
  return (
    <>
      <Link href="/admin/designs" className="link text-sm">All designs</Link>
      <h1 className="mt-2 text-[2.25rem] sm:text-4xl">Rebuild photo designs</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        When the 3D hand changes shape, designs made from photos are rebuilt from their original photo, hand points and brush corrections, so nothing has to be
        uploaded again.
      </p>
      <div className="mt-6">
        <Suspense fallback={<AdaptiveSkeleton />}>
          <Content />
        </Suspense>
      </div>
    </>
  );
}
