import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { CaptureReviewList, type CaptureRow } from "@/components/admin/CaptureReviewList";

export const metadata = { title: "Photo review queue" };

async function Content() {
  await connection();
  await requireRole(["admin"]);
  const db = await getDb();
  // Latest run of every capture: undecided first, then the ones the model was least sure about.
  const rows = await db.query<CaptureRow>(
    `SELECT * FROM (
       SELECT DISTINCT ON (s.id) r.id AS run_id, d.id AS design_id, d.name, s.side, s.photo_url, COALESCE(r.mask_url, da.url) AS mask_url, r.method,
              r.uncertainty, r.review_status, r.landmarks_edited, (r.edits_url IS NOT NULL) AS brushed, s.consent_training,
              r.created_at::text AS created_at
         FROM capture_sources s
         JOIN capture_runs r ON r.source_id = s.id
         LEFT JOIN designs d ON d.id = s.design_id
         -- captures from before mask_url existed: show the design's current henna
         LEFT JOIN design_assets da ON da.design_id = d.id AND da.kind = s.side
        ORDER BY s.id, r.created_at DESC
     ) latest
     ORDER BY (review_status = 'pending') DESC, uncertainty DESC NULLS LAST, created_at DESC
     LIMIT 200`,
  );
  const counts = {
    pending: rows.filter((r) => r.review_status === "pending").length,
    approved: rows.filter((r) => r.review_status === "approved").length,
    trainable: rows.filter((r) => r.review_status === "approved" && r.consent_training).length,
  };
  return <CaptureReviewList rows={rows} counts={counts} />;
}

export default function CapturesPage() {
  return (
    <>
      <Link href="/admin/designs" className="link text-sm">All designs</Link>
      <h1 className="mt-2 text-[2.25rem] sm:text-4xl">Photo review queue</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Check how well the henna was picked out of each uploaded photo. Approved photos become examples the detector learns from, but only when the photo&rsquo;s
        owner agreed to that. Photos the detector was least sure about are listed first.
      </p>
      <div className="mt-6">
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <Content />
        </Suspense>
      </div>
    </>
  );
}
