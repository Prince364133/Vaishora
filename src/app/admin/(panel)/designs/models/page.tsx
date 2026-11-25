import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { autoPromoteEnabled } from "@/server/ml";
import { ModelList, type ModelRow } from "@/components/admin/ModelList";

export const metadata = { title: "Henna detector versions" };

async function Content() {
  await connection();
  await requireRole(["admin"]);
  const db = await getDb();
  const rows = await db.query<ModelRow>(
    `SELECT version, method, metrics, trained_on, status, decision, created_at::text AS created_at, promoted_at::text AS promoted_at, (promoted_by IS NULL AND status IN ('live','retired') AND version > 0) AS auto
       FROM ml_models WHERE task = 'henna' ORDER BY version DESC`,
  );
  const pending = (
    await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT DISTINCT ON (s.id) r.review_status FROM capture_sources s JOIN capture_runs r ON r.source_id = s.id
          WHERE s.consent_training ORDER BY s.id, r.created_at DESC) x WHERE review_status = 'approved'`,
    )
  )[0].n;
  return <ModelList rows={rows} auto={autoPromoteEnabled()} approvedPhotos={pending} />;
}

export default function ModelsPage() {
  return (
    <>
      <Link href="/admin/designs" className="link text-sm">All designs</Link>
      <h1 className="mt-2 text-[2.25rem] sm:text-4xl">Henna detector versions</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        The detector retrains itself from photos you approve in the{" "}
        <Link href="/admin/designs/captures" className="link">review queue</Link> (only when the owner agreed). A new version goes live only if it does better
        than the current one on test photos it never learned from. You can switch back to any version.
      </p>
      <div className="mt-6">
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <Content />
        </Suspense>
      </div>
    </>
  );
}
