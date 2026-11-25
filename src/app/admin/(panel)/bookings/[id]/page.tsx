import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { getBookingById } from "@/server/bookings";
import { currentUser } from "@/server/auth";
import { ActionForm } from "@/components/admin/ActionForm";
import { assignArtistAction, changeBookingStatusAction, refundBookingAction } from "../../../actions";
import { STATUS_LABEL, TRANSITIONS } from "@/lib/booking-status";
import { formatPaise } from "@/lib/money";
import { formatDuration, formatIstDate, formatIstTime } from "@/lib/time";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await getDb();
  const [b, user] = await Promise.all([getBookingById(id, db), currentUser()]);
  if (!b) notFound();
  const [history, payments, refunds, artists] = await Promise.all([
    db.query<{ from_status: string | null; to_status: string; actor_type: string; note: string; created_at: string }>(
      `SELECT from_status, to_status, actor_type, note, created_at FROM booking_status_history WHERE booking_id = $1 ORDER BY created_at, id`,
      [id],
    ),
    db.query<{ provider: string; provider_order_id: string; provider_payment_id: string | null; amount_paise: number; status: string; failure_reason: string | null; created_at: string }>(
      `SELECT provider, provider_order_id, provider_payment_id, amount_paise, status, failure_reason, created_at FROM payments WHERE booking_id = $1 ORDER BY created_at`,
      [id],
    ),
    db.query<{ amount_paise: number; status: string; reason: string; created_at: string }>(`SELECT amount_paise, status, reason, created_at FROM refunds WHERE booking_id = $1 ORDER BY created_at`, [id]),
    // Artists who serve this locality and are free for this booking's block (excluding this booking).
    db.query<{ id: string; name: string; skill_level: string; is_demo: boolean; free: boolean }>(
      `SELECT a.id, a.name, a.skill_level, a.is_demo,
              NOT EXISTS (SELECT 1 FROM bookings o WHERE o.artist_id = a.id AND o.id <> b.id AND o.block && b.block
                          AND o.status IN ('pending_payment','paid','awaiting_artist_confirmation','confirmed','in_progress')) AS free
       FROM artists a JOIN bookings b ON b.id = $1
       JOIN artist_service_areas sa ON sa.artist_id = a.id AND sa.locality_id = b.locality_id
       WHERE a.status = 'active' ORDER BY free DESC, a.name`,
      [id],
    ),
  ]);
  const next = TRANSITIONS[b.status].filter((s) => !["paid", "refund_pending", "refunded"].includes(s));
  const isAdmin = user?.role === "admin";
  const refundable = b.paid_paise - b.refunded_paise;
  const wa = `https://wa.me/${b.customer_phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hello ${b.customer_name}, this is VAISHORA about your booking ${b.code}.`)}`;

  return (
    <>
      <Link href="/admin/bookings" className="link tap-link text-sm">
        All bookings
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-[2.25rem] sm:text-4xl">{b.code}</h1>
        <span className="rounded-full bg-blush px-3 py-1 text-sm font-semibold text-plum">{STATUS_LABEL[b.status]}</span>
      </div>

      <div className="mt-5 grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        {/* Below lg the two columns dissolve (display: contents) so the order utilities can put the
            actions right after the service and customer details on phones. */}
        <div className="max-lg:contents lg:space-y-6">
          <section className="card order-1 p-4 sm:p-5">
            <h2 className="font-sans text-base font-semibold">Service</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Design</dt><dd>{b.design_name}</dd></div>
              <div><dt className="text-muted">When (IST)</dt><dd>{formatIstDate(b.starts_at, true)}, {formatIstTime(b.starts_at)}–{formatIstTime(b.ends_at)} ({formatDuration(b.duration_minutes)})</dd></div>
              <div><dt className="text-muted">Options</dt><dd>{b.items.filter((i) => i.amount_paise > 0).map((i) => i.label).join("; ")}</dd></div>
              <div><dt className="text-muted">People</dt><dd>{b.people_count}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted">Address</dt><dd>{b.address_line}, {b.locality}, {b.city}{b.landmark && ` — near ${b.landmark}`}</dd></div>
              {b.instructions && <div className="sm:col-span-2"><dt className="text-muted">Instructions</dt><dd>{b.instructions}</dd></div>}
              {b.special_requirements && <div className="sm:col-span-2"><dt className="text-muted">Special requirements</dt><dd>{b.special_requirements}</dd></div>}
            </dl>
          </section>

          <section className="card order-2 p-4 sm:p-5">
            <h2 className="font-sans text-base font-semibold">Customer</h2>
            <p className="mt-2 text-sm [overflow-wrap:anywhere]">{b.customer_name} · {b.customer_phone}{b.customer_email && ` · ${b.customer_email}`}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="btn btn-secondary btn-sm flex-1 sm:flex-none" href={`tel:${b.customer_phone}`}>Call</a>
              <a className="btn btn-secondary btn-sm flex-1 sm:flex-none" href={wa} target="_blank" rel="noopener">WhatsApp</a>
            </div>
          </section>

          <section className="card order-4 p-4 sm:p-5">
            <h2 className="font-sans text-base font-semibold">Money</h2>
            <ul className="mt-3 space-y-1 text-sm">
              {b.items.map((i, k) => (
                <li key={k} className="flex justify-between gap-4"><span className="text-muted">{i.label}</span><span className="flex-none tabular-nums">{formatPaise(i.amount_paise)}</span></li>
              ))}
              <li className="flex justify-between border-t hairline pt-2 font-semibold"><span>Total</span><span>{formatPaise(b.total_paise)}</span></li>
              <li className="flex justify-between"><span className="text-muted">Advance</span><span>{formatPaise(b.advance_paise)}</span></li>
              <li className="flex justify-between"><span className="text-muted">Paid online</span><span>{formatPaise(b.paid_paise)}</span></li>
              <li className="flex justify-between"><span className="text-muted">Refunded</span><span>{formatPaise(b.refunded_paise)}</span></li>
            </ul>
            <h3 className="mt-4 text-sm font-semibold">Payment attempts</h3>
            <ul className="mt-1 space-y-1.5 text-xs text-muted [overflow-wrap:anywhere]">
              {payments.map((p) => (
                <li key={p.provider_order_id}>
                  {formatIstDate(p.created_at)} {formatIstTime(p.created_at)} — {p.provider} {p.provider_order_id} {p.provider_payment_id ?? ""} — {formatPaise(p.amount_paise)} — <b>{p.status}</b>{p.failure_reason && ` (${p.failure_reason})`}
                </li>
              ))}
              {refunds.map((r, k) => (
                <li key={k}>Refund {formatPaise(r.amount_paise)} — {r.status} — {r.reason}</li>
              ))}
              {!payments.length && <li>No payment attempts yet.</li>}
            </ul>
          </section>

          <section className="card order-5 p-4 sm:p-5">
            <h2 className="font-sans text-base font-semibold">History</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {history.map((h, k) => (
                <li key={k} className="border-l-2 border-rose pl-3">
                  <span className="font-semibold">{STATUS_LABEL[h.to_status as keyof typeof STATUS_LABEL] ?? h.to_status}</span>
                  <span className="text-muted"> · {h.actor_type} · {formatIstDate(h.created_at)} {formatIstTime(h.created_at)}</span>
                  {h.note && <span className="block text-muted">{h.note}</span>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="max-lg:contents lg:space-y-6">
          <section className="card order-3 p-4 sm:p-5">
            <h2 className="font-sans text-base font-semibold">Artist</h2>
            <p className="mt-1 text-sm">{b.artist_name ? `${b.artist_name} (${b.artist_phone})` : "Not assigned"}</p>
            {["awaiting_artist_assignment", "awaiting_artist_confirmation", "confirmed", "pending_payment"].includes(b.status) && (
              <ActionForm action={assignArtistAction} submitLabel={b.artist_id ? "Reassign" : "Assign artist"} className="mt-3">
                <input type="hidden" name="bookingId" value={b.id} />
                <select name="artistId" className="input" required defaultValue="">
                  <option value="" disabled>Choose an artist serving {b.locality}</option>
                  {artists.map((a) => (
                    <option key={a.id} value={a.id} disabled={!a.free && a.id !== b.artist_id}>
                      {a.name} — {a.skill_level.replace("_", " ")}{a.is_demo ? " (demo)" : ""}{!a.free ? " — busy" : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">Busy artists have an overlapping booking (including travel buffer).</p>
              </ActionForm>
            )}
          </section>

          {next.length > 0 && (
            <section className="card order-3 p-4 sm:p-5">
              <h2 className="font-sans text-base font-semibold">Change status</h2>
              <ActionForm action={changeBookingStatusAction} submitLabel="Update status" className="mt-3 space-y-2">
                <input type="hidden" name="bookingId" value={b.id} />
                <select name="status" className="input" required defaultValue="">
                  <option value="" disabled>Choose next status</option>
                  {next.map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
                <input name="note" className="input" placeholder="Note (optional)" maxLength={300} />
                {b.paid_paise > 0 && next.includes("cancelled") && <p className="text-xs text-muted">Cancelling a paid booking here does not refund it. Use the refund form for that.</p>}
              </ActionForm>
            </section>
          )}

          {isAdmin && refundable > 0 && !["refunded"].includes(b.status) && (
            <section className="card order-3 p-4 sm:p-5">
              <h2 className="font-sans text-base font-semibold">Cancel and refund</h2>
              <p className="mt-1 text-xs text-muted">Refunds go back to the original payment method through the payment gateway.</p>
              <ActionForm action={refundBookingAction} submitLabel="Issue refund" danger className="mt-3 space-y-2">
                <input type="hidden" name="bookingId" value={b.id} />
                <label className="field">
                  <span className="label">Amount (₹), max {formatPaise(refundable)}</span>
                  <input name="amount" type="number" inputMode="numeric" min={0} step={1} max={refundable / 100} defaultValue={refundable / 100} className="input" />
                </label>
                <input name="reason" className="input" placeholder="Reason" maxLength={200} required />
              </ActionForm>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export default function BookingDetailPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <Detail {...props} />
    </Suspense>
  );
}
