import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { mlCaller } from "@/server/ml";

// Training manifest for scripts/ml/autolearn.py (docs/HAND_AI_ARCHITECTURE.md §5.3): ONLY captures whose latest
// run an admin approved AND whose photo owner opted in to training. Each item has the photo fitted to the hand
// frame and the final henna mask (detector + brush corrections) for that same run. Worker token or admin session.
export async function GET(req: Request) {
  if (!(await mlCaller(req))) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const db = await getDb();
  const items = await db.query(
    `SELECT latest.*, ph.url AS frame_photo_url, COALESCE(latest.run_mask_url, mk.url) AS mask_url FROM (
       SELECT DISTINCT ON (s.id) s.id AS source_id, s.design_id, s.side, s.photo_url, s.width, s.height, r.id AS run_id, r.method, r.params,
              r.landmarks, r.edits_url, r.mask_url AS run_mask_url, r.frame_version, r.review_status, r.reviewed_at::text AS reviewed_at
         FROM capture_sources s JOIN capture_runs r ON r.source_id = s.id
        WHERE s.consent_training AND s.rights_confirmed
        ORDER BY s.id, r.created_at DESC
     ) latest
     LEFT JOIN design_assets ph ON ph.design_id = latest.design_id AND ph.kind = latest.side || '_photo'
     LEFT JOIN design_assets mk ON mk.design_id = latest.design_id AND mk.kind = latest.side
     WHERE latest.review_status = 'approved'`,
  );
  return NextResponse.json({ generated: new Date().toISOString(), count: items.length, items }, { headers: { "Cache-Control": "no-store" } });
}
