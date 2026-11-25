import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { BOOKING_STATUSES, STATUS_LABEL, BookingStatus } from "@/lib/booking-status";
import { formatPaise } from "@/lib/money";
import { formatIstDate, formatIstTime } from "@/lib/time";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";

export const metadata = { title: "Bookings" };

async function List({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await connection();
  const sp = await searchParams;
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (sp.status === "needs_action") where.push(`b.status IN ('awaiting_artist_assignment','awaiting_artist_confirmation','refund_pending')`);
  else if (sp.status && (BOOKING_STATUSES as readonly string[]).includes(sp.status)) {
    params.push(sp.status);
    where.push(`b.status = $${params.length}`);
  }
  if (sp.q) {
    params.push(`%${sp.q.trim()}%`);
    where.push(`(b.code ILIKE $${params.length} OR c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`);
  }
  const rows = await db.query<{ id: string; code: string; status: BookingStatus; starts_at: string; design: string; customer: string; phone: string; locality: string; artist: string | null; total_paise: number; created_at: string }>(
    `SELECT b.id, b.code, b.status, b.starts_at, d.name AS design, c.name AS customer, c.phone, l.name AS locality, a.name AS artist, b.total_paise, b.created_at
     FROM bookings b JOIN designs d ON d.id = b.design_id JOIN customers c ON c.id = b.customer_id JOIN localities l ON l.id = b.locality_id LEFT JOIN artists a ON a.id = b.artist_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY b.starts_at DESC LIMIT 200`,
    params,
  );
  return (
    <>
    <p className="mt-4 text-sm text-muted md:hidden">
      {rows.length} {rows.length === 1 ? "booking" : "bookings"}
    </p>
    <ul className="mt-2 space-y-2 md:hidden">
      {rows.map((b) => (
        <li key={b.id} className="card relative p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <Link className="link stretched-link font-semibold" href={`/admin/bookings/${b.id}`}>
              {b.code}
            </Link>
            <span className="rounded-full bg-blush px-2.5 py-0.5 text-right text-xs font-semibold text-plum">{STATUS_LABEL[b.status]}</span>
          </div>
          <p className="mt-1 font-semibold text-plum-ink">
            {formatIstDate(b.starts_at)}, {formatIstTime(b.starts_at)}
          </p>
          <p>
            {b.customer} <span className="text-muted">· {b.phone}</span>
          </p>
          <p className="text-muted">
            {b.design} · {b.locality}
          </p>
          <div className="mt-2 flex items-center justify-between gap-3 border-t hairline pt-2">
            <span className="text-muted">{b.artist ?? "No artist yet"}</span>
            <span className="font-semibold tabular-nums">{formatPaise(b.total_paise)}</span>
          </div>
        </li>
      ))}
      {!rows.length && <li className="card p-6 text-center text-muted">No bookings match.</li>}
    </ul>
    <div className="mt-4 hidden overflow-x-auto card md:block">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b hairline">
            <th className="p-3">Booking</th>
            <th className="p-3">Service time (IST)</th>
            <th className="p-3">Customer</th>
            <th className="p-3">Design</th>
            <th className="p-3">Area</th>
            <th className="p-3">Artist</th>
            <th className="p-3 text-right">Total</th>
            <th className="p-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} className="border-b hairline last:border-0 hover:bg-blush/30">
              <td className="p-3">
                <Link className="link font-semibold" href={`/admin/bookings/${b.id}`}>
                  {b.code}
                </Link>
              </td>
              <td className="p-3 whitespace-nowrap">{formatIstDate(b.starts_at)}, {formatIstTime(b.starts_at)}</td>
              <td className="p-3">
                {b.customer}
                <span className="block text-xs text-muted">{b.phone}</span>
              </td>
              <td className="p-3">{b.design}</td>
              <td className="p-3">{b.locality}</td>
              <td className="p-3">{b.artist ?? "—"}</td>
              <td className="p-3 text-right tabular-nums">{formatPaise(b.total_paise)}</td>
              <td className="p-3">{STATUS_LABEL[b.status]}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={8} className="p-8 text-center text-muted">
                No bookings match.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}

export default function BookingsPage(props: { searchParams: Promise<{ status?: string; q?: string }> }) {
  return (
    <>
      <h1 className="text-[2.25rem] sm:text-4xl">Bookings</h1>
      <form className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:flex-wrap" role="search">
        <input name="q" type="search" enterKeyHint="search" autoComplete="off" aria-label="Search bookings" className="input col-span-2 sm:max-w-xs" placeholder="Booking ID, name or phone" />
        <select name="status" aria-label="Status" className="input sm:max-w-[16rem]">
          <option value="">All statuses</option>
          <option value="needs_action">Needs action</option>
          {BOOKING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary">Filter</button>
      </form>
      <Suspense fallback={<AdaptiveSkeleton />}>
        <List {...props} />
      </Suspense>
    </>
  );
}
