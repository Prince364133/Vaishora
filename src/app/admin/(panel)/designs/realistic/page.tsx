import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { getFeatures } from "@/server/features";
import { liveModel } from "@/server/ml";
import { RealisticLab, type LabDesign } from "@/components/admin/RealisticLab";

export const metadata = { title: "Realistic 3D" };

async function Content() {
  await connection();
  await requireRole(["admin"]);
  const db = await getDb();
  // Designs with uploaded hand artwork (artist uploads and admin photo imports), newest first.
  const designs = await db.query<LabDesign>(
    `SELECT d.id, d.slug, d.name, d.region, d.status, d.review_status, ar.name AS artist_name, d.updated_at::text AS updated_at,
            COALESCE((SELECT jsonb_object_agg(a.kind, a.url) FROM design_assets a WHERE a.design_id = d.id), '{}'::jsonb) AS assets,
            (SELECT r.review_status FROM capture_sources s JOIN capture_runs r ON r.source_id = s.id WHERE s.design_id = d.id ORDER BY r.created_at DESC LIMIT 1) AS capture_status,
            (SELECT r.method FROM capture_sources s JOIN capture_runs r ON r.source_id = s.id WHERE s.design_id = d.id ORDER BY r.created_at DESC LIMIT 1) AS capture_method
       FROM designs d
       LEFT JOIN artists ar ON ar.id = d.artist_id
      WHERE EXISTS (SELECT 1 FROM design_assets a WHERE a.design_id = d.id AND a.source = 'upload' AND a.kind IN ('palm', 'back'))
      ORDER BY d.updated_at DESC
      LIMIT 200`,
  );
  const queue = (
    await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (SELECT DISTINCT ON (s.id) r.review_status FROM capture_sources s JOIN capture_runs r ON r.source_id = s.id
         ORDER BY s.id, r.created_at DESC) x WHERE review_status = 'pending'`,
    )
  )[0].n;
  const [features, live] = await Promise.all([getFeatures(db), liveModel()]);
  return <RealisticLab designs={designs} live={features.realistic3d} pendingReview={queue} detector={live ? live.method : null} />;
}

export default function RealisticPage() {
  return (
    <>
      <Link href="/admin/designs" className="link text-sm">All designs</Link>
      <h1 className="mt-2 text-[2.25rem] sm:text-4xl">Realistic 3D</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        The Realistic 3D hand is being trained and checked here. Customers only see the 3D model until you switch Realistic 3D on. Every design uploaded by
        an artist (or imported from a photo) is listed below, so you can check how it looks on both before going live.
      </p>
      <div className="mt-6">
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <Content />
        </Suspense>
      </div>
    </>
  );
}
