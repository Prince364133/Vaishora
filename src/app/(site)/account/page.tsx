import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentCustomer } from "@/server/customer-auth";
import { getDb } from "@/server/db";
import { bookingAccessToken } from "@/server/bookings";
import { currentArtist, devLoginEnabled } from "@/server/artist-auth";
import { STATUS_LABEL, BookingStatus } from "@/lib/booking-status";
import { formatPaise } from "@/lib/money";
import { formatIstDate, formatIstTime } from "@/lib/time";
import { AccountAuthCard } from "./AccountAuthCard";
import { AccountShell } from "@/components/account/AccountShell";
import { AdaptiveSkeleton } from "@/components/site/AdaptiveSkeleton";
import { REVIEW_ALLOWED_SQL } from "@/server/reviews";

export const metadata: Metadata = { title: "My account", robots: { index: false } };

type SP = { artist?: string; applied?: string; tab?: string; q?: string };

const UPCOMING = ["pending_payment", "paid", "awaiting_artist_assignment", "awaiting_artist_confirmation", "confirmed", "in_progress"];
const tone = (s: BookingStatus) =>
  s === "confirmed" || s === "completed" ? "bg-[#e6f2ea] text-success" : s === "cancelled" || s === "refunded" || s === "refund_pending" ? "bg-[#f6e3e3] text-danger" : "bg-gold/25 text-henna";

async function Account({ searchParams }: { searchParams: Promise<SP> }) {
  await connection();
  // A signed-in artist belongs in their portal.
  if (await currentArtist()) redirect("/artist-portal");
  const sp = await searchParams;
  const me = await currentCustomer();
  if (!me || sp.artist)
    return (
      <div className="container-v max-w-2xl py-8 md:py-12">
        <h1 className="text-[2.5rem] md:text-5xl">Sign in</h1>
        <AccountAuthCard artistMode={!!sp.artist} applied={!!sp.applied} devLogin={devLoginEnabled()} />
      </div>
    );
  const tab = sp.tab === "past" ? "past" : "upcoming";
  const q = (sp.q ?? "").trim().slice(0, 60);
  const db = await getDb();
  const params: unknown[] = [me.id, UPCOMING];
  let search = "";
  if (q) {
    params.push(`%${q}%`);
    search = ` AND (b.code ILIKE $3 OR d.name ILIKE $3 OR l.name ILIKE $3 OR b.address_line ILIKE $3)`;
  }
  const where =
    tab === "upcoming" ? `b.status = ANY($2::text[]) AND b.starts_at > now() - interval '6 hours'` : `NOT (b.status = ANY($2::text[]) AND b.starts_at > now() - interval '6 hours')`;
  const [rows, counts] = await Promise.all([
    db.query<{ id: string; code: string; status: BookingStatus; starts_at: string; design: string; total_paise: number; locality: string; artist: string | null; photo: string | null; can_rate: boolean }>(
      `SELECT b.id, b.code, b.status, b.starts_at, d.name AS design, b.total_paise, l.name AS locality, a.name AS artist,
              ((${REVIEW_ALLOWED_SQL}) AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)) AS can_rate,
              (SELECT p.url FROM design_photos p WHERE p.design_id = d.id ORDER BY p.sort LIMIT 1) AS photo
       FROM bookings b JOIN designs d ON d.id = b.design_id JOIN localities l ON l.id = b.locality_id LEFT JOIN artists a ON a.id = b.artist_id
       WHERE b.customer_id = $1 AND b.status <> 'expired' AND ${where}${search}
       ORDER BY b.starts_at ${tab === "upcoming" ? "ASC" : "DESC"} LIMIT 100`,
      params,
    ),
    db.query<{ upcoming: number; tickets: number }>(
      `SELECT (SELECT count(*)::int FROM bookings WHERE customer_id = $1 AND status = ANY($2::text[]) AND starts_at > now() - interval '6 hours') AS upcoming,
              (SELECT count(*)::int FROM support_tickets WHERE customer_id = $1 AND status = 'awaiting_reply') AS tickets`,
      [me.id, UPCOMING],
    ),
  ]);
  return (
    <AccountShell customer={me} tab="bookings" badge={{ support: counts[0].tickets }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="inline-grid w-full grid-cols-2 rounded-full bg-blush p-0.5 text-center text-sm font-semibold sm:w-auto" role="tablist" aria-label="Bookings">
          {(
            [
              ["upcoming", `Upcoming${counts[0].upcoming ? ` (${counts[0].upcoming})` : ""}`],
              ["past", "Past"],
            ] as const
          ).map(([k, l]) => (
            <Link key={k} href={`/account?tab=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} role="tab" aria-selected={tab === k} className={`min-h-10 rounded-full px-4 leading-10 ${tab === k ? "bg-plum text-ivory" : "text-plum"}`}>
              {l}
            </Link>
          ))}
        </div>
        <form role="search" className="flex w-full min-w-0 gap-2 sm:flex-1" action="/account">
          <input type="hidden" name="tab" value={tab} />
          <label htmlFor="bq" className="sr-only">
            Search bookings
          </label>
          <input id="bq" name="q" type="search" enterKeyHint="search" defaultValue={q} placeholder="Booking ID, design or area" className="input min-h-10 min-w-0 flex-1 py-2" />
          <button className="btn btn-secondary btn-sm flex-none">Search</button>
        </form>
      </div>
      <ul className="mt-4 space-y-3">
        {rows.map((b) => (
          <li key={b.id} className="space-y-1">
            <Link href={`/booking/${bookingAccessToken(b.id)}`} className="card flex items-center gap-3 p-3 hover:border-rose sm:p-4">
              {b.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.photo} alt="" loading="lazy" className="h-16 w-16 flex-none rounded-[var(--radius-sm)] object-cover" />
              ) : (
                <span className="grid h-16 w-16 flex-none place-items-center rounded-[var(--radius-sm)] bg-blush text-center text-xs font-semibold text-plum">
                  {formatIstDate(b.starts_at).split(" ").slice(0, 2).join(" ")}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-plum-ink">{b.design}</span>
                <span className="block text-sm text-muted">
                  {formatIstDate(b.starts_at)}, {formatIstTime(b.starts_at)} · {b.locality}
                </span>
                <span className="block text-xs text-muted">
                  {b.code}
                  {b.artist ? ` · ${b.artist}` : ""}
                </span>
              </span>
              <span className="flex-none text-right text-sm">
                <span className="block font-semibold text-plum">{formatPaise(b.total_paise)}</span>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${tone(b.status)}`}>{STATUS_LABEL[b.status]}</span>
              </span>
            </Link>
            {b.can_rate && (
              <Link href={`/review/${bookingAccessToken(b.id)}`} className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-gold/20 text-sm font-semibold text-henna">
                <span aria-hidden>★</span> Rate {b.artist ? b.artist.split(" ")[0] : "your artist"}
              </Link>
            )}
          </li>
        ))}
        {!rows.length && (
          <li className="card p-6 text-center text-muted">
            {q ? (
              <>No bookings match “{q}”.</>
            ) : tab === "upcoming" ? (
              <>
                No upcoming bookings.{" "}
                <Link href="/designs" className="link">
                  Choose a design
                </Link>
                .
              </>
            ) : (
              "No past bookings yet."
            )}
          </li>
        )}
      </ul>
      <p className="mt-6 text-sm text-muted">
        Need help with a booking?{" "}
        <Link href="/account/support" className="link">
          Raise a support ticket
        </Link>
      </p>
    </AccountShell>
  );
}

export default function AccountPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<AdaptiveSkeleton variant="account" />}>
      <Account searchParams={searchParams} />
    </Suspense>
  );
}
