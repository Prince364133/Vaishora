import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { getDb } from "@/server/db";

// Training manifest for scripts/ml (docs/HAND_AI_ARCHITECTURE.md §5.3): ONLY captures whose latest run an admin
// approved AND whose photo owner opted in to training. Admin session required; never cached.
export async function GET() {
  const user = await currentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const db = await getDb();
  const items = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (s.id) s.id AS source_id, s.side, s.photo_url, s.width, s.height, r.id AS run_id, r.method, r.params,
              r.landmarks, r.edits_url, r.mask_url, r.frame_version, r.review_status, r.reviewed_at::text AS reviewed_at
         FROM capture_sources s JOIN capture_runs r ON r.source_id = s.id
        WHERE s.consent_training AND s.rights_confirmed
        ORDER BY s.id, r.created_at DESC
     ) latest
     WHERE review_status = 'approved'`,
  );
  return NextResponse.json({ generated: new Date().toISOString(), count: items.length, items }, { headers: { "Cache-Control": "no-store" } });
}
