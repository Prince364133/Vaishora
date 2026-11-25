import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { expireStaleHolds } from "@/server/availability";
import { formatPaise } from "@/lib/money";
import { STATUS_LABEL, BookingStatus } from "@/lib/booking-status";
import { formatIstDate, formatIstTime, istDateString } from "@/lib/time";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";

async function Dashboard() {
  await connection();
  const db = await getDb();
  await expireStaleHolds(db);
  const today = istDateString();
  const [platform] = await db.query<{ artists: number; pending_artists: number; pending_designs: number; margin_month: number; margin_all: number; payouts: number; tickets: number; customers: number }>(
    `SELECT (SELECT count(*)::int FROM artists WHERE status = 'active' AND NOT is_demo) AS artists,
            (SELECT count(*)::int FROM artists WHERE status = 'pending') AS pending_artists,
            (SELECT count(*)::int FROM designs WHERE review_status = 'pending') AS pending_designs,
            COALESCE((SELECT sum(margin_paise) FROM artist_ledger WHERE kind = 'booking'
               AND created_at >= (date_trunc('month', (now() AT TIME ZONE 'UTC') + interval '330 minutes') - interval '330 minutes') AT TIME ZONE 'UTC'), 0)::int AS margin_month,
            COALESCE((SELECT sum(margin_paise) FROM artist_ledger WHERE kind = 'booking'), 0)::int AS margin_all,
            (SELECT count(*)::int FROM payout_requests WHERE status IN ('requested','approved')) AS payouts,
            (SELECT count(*)::int FROM support_tickets WHERE status = 'open') AS tickets,
            (SELECT count(*)::int FROM customers) AS customers`,
  );
  const [counts, todayRows, money, upcoming, needs] = await Promise.all([
    db.query<{ status: BookingStatus; n: number }>(`SELECT status, count(*)::int AS n FROM bookings GROUP BY status`),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings WHERE ((starts_at AT TIME ZONE 'UTC') + interval '330 minutes')::date = $1::date AND status NOT IN ('expired','cancelled','refunded')`, [today]),
    db.query<{ captured: number; refunded: number; payments: number; failed: number }>(
      `SELECT COALESCE((SELECT sum(amount_paise) FROM payments WHERE status IN ('captured','partially_refunded','refunded')),0)::int AS captured,
              COALESCE((SELECT sum(amount_paise) FROM refunds WHERE status <> 'failed'),0)::int AS refunded,
              (SELECT count(*)::int FROM payments WHERE status IN ('captured','partially_refunded','refunded')) AS payments,
              (SELECT count(*)::int FROM payments WHERE status = 'failed') AS failed`,
    ),
    db.query<{ id: string; code: string; status: BookingStatus; starts_at: string; design: string; locality: string; artist: string | null }>(
      `SELECT b.id, b.code, b.status, b.starts_at, d.name AS design, l.name AS locality, a.name AS artist
       FROM bookings b JOIN designs d ON d.id = b.design_id JOIN localities l ON l.id = b.locality_id LEFT JOIN artists a ON a.id = b.artist_id
       WHERE b.starts_at > now() - interval '12 hours' AND b.status IN ('awaiting_artist_assignment','awaiting_artist_confirmation','confirmed','in_progress')
       ORDER BY b.starts_at LIMIT 10`,
    ),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM bookings WHERE status IN ('awaiting_artist_assignment','awaiting_artist_confirmation')`),
  ]);
  const c = (s: BookingStatus[]) => counts.filter((r) => s.includes(r.status)).reduce((a, r) => a + r.n, 0);
  const total = counts.reduce((a, r) => a + r.n, 0);
  const m = money[0];
  const cancelled = c(["cancelled", "refund_pending", "refunded"]);
  const realised = total - c(["expired"]);
  const alerts: [string, string][] = [
    ...(platform.pending_artists ? [[`/admin/verification?tab=artists`, `${platform.pending_artists} artist application${platform.pending_artists > 1 ? "s" : ""} to verify`] as [string, string]] : []),
    ...(platform.pending_designs ? [[`/admin/verification?tab=designs`, `${platform.pending_designs} design${platform.pending_designs > 1 ? "s" : ""} waiting for review`] as [string, string]] : []),
    ...(platform.payouts ? [[`/admin/payouts`, `${platform.payouts} payout request${platform.payouts > 1 ? "s" : ""} to process`] as [string, string]] : []),
    ...(platform.tickets ? [[`/admin/support`, `${platform.tickets} support ticket${platform.tickets > 1 ? "s" : ""} need a reply`] as [string, string]] : []),
  ];
  const tiles: [string, string, string?][] = [
    ["Active artists", String(platform.artists), `${platform.pending_artists} awaiting verification`],
    ["Platform margin", formatPaise(platform.margin_month), `this month · ${formatPaise(platform.margin_all)} all time`],
    ["Customers", String(platform.customers), "accounts and guest bookers"],
    ["Total bookings", String(total), "all statuses"],
    ["Today", String(todayRows[0].n), "active bookings today (IST)"],
    ["Pending", String(c(["pending_payment", "awaiting_artist_assignment", "awaiting_artist_confirmation"])), "awaiting payment or artist"],
    ["Confirmed", String(c(["confirmed", "in_progress"])), "upcoming and in progress"],
    ["Completed", String(c(["completed"]))],
    ["Advances collected", formatPaise(m.captured - m.refunded), `${formatPaise(m.captured)} captured, ${formatPaise(m.refunded)} refunded`],
    ["Payments", String(m.payments), `${m.failed} failed attempts`],
    ["Cancellation rate", realised ? `${Math.round((cancelled / realised) * 100)}%` : "—", `${cancelled} cancelled or refunded`],
  ];
  return (
    <>
      {alerts.length > 0 && (
        <ul className="mb-4 grid gap-2 sm:grid-cols-2">
          {alerts.map(([href, text]) => (
            <li key={href}>
              <Link href={href} className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-gold bg-gold/15 px-4 py-3 text-sm font-semibold">
                {text} <span aria-hidden>→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, value, hint]) => (
          <div key={label} className="card p-3.5 sm:p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-[1.35rem] font-semibold text-plum tabular-nums sm:text-2xl">{value}</p>
            {hint && <p className="text-xs text-muted">{hint}</p>}
          </div>
        ))}
      </div>
      {needs[0].n > 0 && (
        <Link href="/admin/bookings?status=needs_action" className="mt-4 block rounded-[var(--radius-sm)] border border-gold bg-gold/15 px-4 py-3 text-sm font-semibold">
          {needs[0].n} paid booking{needs[0].n > 1 ? "s" : ""} need an artist assigned or confirmed →
        </Link>
      )}
      <section className="mt-8">
        <h2 className="text-2xl">Upcoming</h2>
        {/* Phones: one card per booking. Tablets and up: the table. */}
        <ul className="mt-3 space-y-2 md:hidden">
          {upcoming.map((b) => (
            <li key={b.id} className="card relative p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <Link className="link stretched-link font-semibold" href={`/admin/bookings/${b.id}`}>
                  {b.code}
                </Link>
                <span className="rounded-full bg-blush px-2.5 py-0.5 text-xs font-semibold text-plum">{STATUS_LABEL[b.status]}</span>
              </div>
              <p className="mt-1 font-semibold text-plum-ink">
                {formatIstDate(b.starts_at)}, {formatIstTime(b.starts_at)}
              </p>
              <p className="text-muted">
                {b.design} · {b.locality}
              </p>
              <p className="mt-1">{b.artist ?? <span className="text-danger">Unassigned</span>}</p>
            </li>
          ))}
          {!upcoming.length && <li className="card p-6 text-center text-muted">No upcoming bookings.</li>}
        </ul>
        <div className="mt-3 hidden overflow-x-auto card md:block">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b hairline">
                <th className="p-3">Booking</th>
                <th className="p-3">When (IST)</th>
                <th className="p-3">Design</th>
                <th className="p-3">Area</th>
                <th className="p-3">Artist</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((b) => (
                <tr key={b.id} className="border-b hairline last:border-0">
                  <td className="p-3">
                    <Link className="link font-semibold" href={`/admin/bookings/${b.id}`}>
                      {b.code}
                    </Link>
                  </td>
                  <td className="p-3">{formatIstDate(b.starts_at)}, {formatIstTime(b.starts_at)}</td>
                  <td className="p-3">{b.design}</td>
                  <td className="p-3">{b.locality}</td>
                  <td className="p-3">{b.artist ?? <span className="text-danger">Unassigned</span>}</td>
                  <td className="p-3">{STATUS_LABEL[b.status]}</td>
                </tr>
              ))}
              {!upcoming.length && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted">
                    No upcoming bookings.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function AdminHome() {
  return (
    <>
      <h1 className="text-[2.25rem] sm:text-4xl">Dashboard</h1>
      <div className="mt-5">
        <Suspense fallback={<AdaptiveSkeleton />}>
          <Dashboard />
        </Suspense>
      </div>
    </>
  );
}
