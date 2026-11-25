import { Suspense } from "react";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { currentUser } from "@/server/auth";
import { ActionForm } from "@/components/admin/ActionForm";
import { addExternalReviewAction, moderateReviewAction } from "../../actions";
import { formatIstDate } from "@/lib/time";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";

export const metadata = { title: "Reviews" };

async function Content() {
  await connection();
  const db = await getDb();
  const user = await currentUser();
  const rows = await db.query<{
    id: string; rating: number; body: string; status: string; source: string; source_url: string | null; evidence_note: string | null;
    name: string | null; code: string | null; created_at: string;
  }>(
    `SELECT r.id, r.rating, r.body, r.status, r.source, r.source_url, r.evidence_note,
            COALESCE(c.name, r.reviewer_name) AS name, b.code, r.created_at
     FROM reviews r LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN bookings b ON b.id = r.booking_id
     ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 200`,
  );
  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-3">
        {rows.map((r) => (
          <article key={r.id} className="card p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                {"★".repeat(r.rating)}
                <span className="text-muted">{"★".repeat(5 - r.rating)}</span> · {r.name ?? "—"}
              </p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === "published" ? "bg-success/10 text-success" : r.status === "pending" ? "bg-gold/20" : "bg-blush text-muted"}`}>{r.status}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {r.source === "booking" ? `Booking ${r.code}` : r.source} · {formatIstDate(r.created_at)}
              {r.source_url && (
                <>
                  {" · "}
                  <a className="link" href={r.source_url} target="_blank" rel="noopener nofollow">original</a>
                </>
              )}
              {r.evidence_note && ` · ${r.evidence_note}`}
            </p>
            <p className="mt-2 whitespace-pre-wrap">{r.body}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {r.status !== "published" && (
                <ActionForm action={moderateReviewAction} submitLabel="Publish">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="status" value="published" />
                </ActionForm>
              )}
              {r.status !== "hidden" && (
                <ActionForm action={moderateReviewAction} submitLabel="Hide" danger>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="status" value="hidden" />
                </ActionForm>
              )}
            </div>
          </article>
        ))}
        {!rows.length && <p className="card p-8 text-center text-muted">No reviews yet. Customers can review completed bookings from their booking page.</p>}
      </div>
      {user?.role === "admin" && (
        <section className="card h-fit p-5">
          <h2 className="font-sans text-base font-semibold">Add a review received elsewhere</h2>
          <p className="mt-1 text-xs text-muted">Only genuine reviews you actually received (Google, WhatsApp, Instagram…). Paste the text exactly; keep the evidence. Inventing or editing reviews is misleading advertising.</p>
          <ActionForm action={addExternalReviewAction} submitLabel="Add review" className="mt-3 space-y-2">
            <input name="reviewer_name" className="input" placeholder="Reviewer name (as on the original)" required />
            <select name="rating" className="input" defaultValue="5">
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 ? "s" : ""}</option>)}
            </select>
            <textarea name="body" className="input min-h-28" placeholder="Review text, exactly as written" required />
            <select name="source" className="input" defaultValue="google">
              <option value="google">Google</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="other">Other</option>
            </select>
            <input name="source_url" className="input" placeholder="Link to the original review (if public)" />
            <input name="evidence_note" className="input" placeholder="Where the evidence is kept (e.g. WhatsApp screenshot in Drive)" />
            <label className="field"><span className="label">Date of review</span><input name="reviewed_on" type="date" className="input" /></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent" className="mt-1" /> This review is genuine, unedited, and we may display it.</label>
          </ActionForm>
        </section>
      )}
    </div>
  );
}

export default function ReviewsAdminPage() {
  return (
    <>
      <h1 className="text-4xl">Reviews</h1>
      <Suspense fallback={<AdaptiveSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}
