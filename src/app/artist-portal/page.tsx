import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { ActionForm } from "@/components/admin/ActionForm";
import { artistRespondAction, logoutAction } from "../admin/actions";
import { STATUS_LABEL, BookingStatus } from "@/lib/booking-status";
import { formatDuration, formatIstDate, formatIstTime } from "@/lib/time";

export const metadata: Metadata = { title: "Artist portal", robots: { index: false } };

async function Portal() {
  await connection();
  const user = await requireRole(["artist"]);
  const db = await getDb();
  // Artists see only bookings assigned to them, and only the details needed to do the job.
  const rows = user.artist_id
    ? await db.query<{ id: string; code: string; status: BookingStatus; starts_at: string; duration_minutes: number; design: string; locality: string; address_line: string; landmark: string; instructions: string; special_requirements: string; customer_first: string; customer_phone: string; people_count: number }>(
        `SELECT b.id, b.code, b.status, b.starts_at, b.duration_minutes, d.name AS design, l.name AS locality,
                b.address_line, b.landmark, b.instructions, b.special_requirements, split_part(c.name, ' ', 1) AS customer_first,
                CASE WHEN b.status IN ('confirmed','in_progress') THEN c.phone ELSE NULL END AS customer_phone, b.people_count
         FROM bookings b JOIN designs d ON d.id = b.design_id JOIN localities l ON l.id = b.locality_id JOIN customers c ON c.id = b.customer_id
         WHERE b.artist_id = $1 AND b.status IN ('awaiting_artist_confirmation','confirmed','in_progress','completed') AND b.starts_at > now() - interval '7 days'
         ORDER BY b.starts_at`,
        [user.artist_id],
      )
    : [];
  return (
    <main className="mx-auto max-w-3xl px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] sm:py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-[2.25rem] sm:text-4xl">Your bookings</h1>
        <form action={logoutAction}><button className="btn btn-ghost">Sign out</button></form>
      </div>
      <p className="text-muted">Hello {user.name}. Times are IST. Customer phone numbers appear once you accept.</p>
      {!user.artist_id && <p className="mt-4 text-danger">Your login is not linked to an artist profile yet. Please contact the VAISHORA team.</p>}
      <div className="mt-6 space-y-4">
        {rows.map((b) => (
          <article key={b.id} className="card p-4 [overflow-wrap:anywhere] sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-display text-[1.6rem] leading-tight text-plum sm:text-2xl">{formatIstDate(b.starts_at)}, {formatIstTime(b.starts_at)}</p>
              <span className="rounded-full bg-blush px-3 py-1 text-xs font-semibold">{STATUS_LABEL[b.status]}</span>
            </div>
            <p className="mt-1 text-sm">{b.design} · {formatDuration(b.duration_minutes)} · {b.people_count} {b.people_count > 1 ? "people" : "person"} · {b.code}</p>
            <p className="mt-2 text-sm"><span className="text-muted">Where:</span> {b.status === "awaiting_artist_confirmation" ? b.locality : `${b.address_line}, ${b.locality}${b.landmark ? ` (near ${b.landmark})` : ""}`}</p>
            {b.customer_phone && <p className="text-sm"><span className="text-muted">Customer:</span> {b.customer_first} · <a className="link tap-link" href={`tel:${b.customer_phone}`}>{b.customer_phone}</a></p>}
            {b.instructions && b.status !== "awaiting_artist_confirmation" && <p className="text-sm"><span className="text-muted">Instructions:</span> {b.instructions}</p>}
            {b.special_requirements && <p className="text-sm"><span className="text-muted">Requests:</span> {b.special_requirements}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {b.status === "awaiting_artist_confirmation" && (
                <>
                  <ActionForm action={artistRespondAction} submitLabel="Accept booking"><input type="hidden" name="bookingId" value={b.id} /><input type="hidden" name="decision" value="accept" /></ActionForm>
                  <ActionForm action={artistRespondAction} submitLabel="Decline" danger><input type="hidden" name="bookingId" value={b.id} /><input type="hidden" name="decision" value="reject" /></ActionForm>
                </>
              )}
              {b.status === "confirmed" && <ActionForm action={artistRespondAction} submitLabel="Start session"><input type="hidden" name="bookingId" value={b.id} /><input type="hidden" name="decision" value="start" /></ActionForm>}
              {b.status === "in_progress" && <ActionForm action={artistRespondAction} submitLabel="Mark completed"><input type="hidden" name="bookingId" value={b.id} /><input type="hidden" name="decision" value="complete" /></ActionForm>}
            </div>
          </article>
        ))}
        {user.artist_id && !rows.length && <p className="card p-6 text-center text-muted">No bookings assigned right now.</p>}
      </div>
    </main>
  );
}

export default function ArtistPortalPage() {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Loading…</p>}>
      <Portal />
    </Suspense>
  );
}
