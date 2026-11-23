import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { currentCustomer } from "@/server/customer-auth";
import { getDb } from "@/server/db";
import { bookingAccessToken } from "@/server/bookings";
import { STATUS_LABEL, BookingStatus } from "@/lib/booking-status";
import { formatPaise } from "@/lib/money";
import { formatIstDate, formatIstTime } from "@/lib/time";
import { SignOutButton } from "./SignOutButton";
import { AccountAuthCard } from "./AccountAuthCard";

export const metadata: Metadata = { title: "My bookings", robots: { index: false } };

async function Bookings() {
  await connection();
  const me = await currentCustomer();
  if (!me) return <AccountAuthCard />;
  const db = await getDb();
  const rows = await db.query<{ id: string; code: string; status: BookingStatus; starts_at: string; design: string; total_paise: number }>(
    `SELECT b.id, b.code, b.status, b.starts_at, d.name AS design, b.total_paise FROM bookings b JOIN designs d ON d.id = b.design_id
     WHERE b.customer_id = $1 AND b.status <> 'expired' ORDER BY b.starts_at DESC LIMIT 50`,
    [me.id],
  );
  return (
    <>
      <p className="mt-2 text-muted">Signed in as {me.name || me.email || me.phone}.</p>
      <ul className="mt-6 space-y-3">
        {rows.map((b) => (
          <li key={b.id}>
            <Link href={`/booking/${bookingAccessToken(b.id)}`} className="card flex items-center justify-between gap-3 p-4 hover:border-rose">
              <span className="min-w-0">
                <span className="block font-semibold">{b.design}</span>
                <span className="block text-sm text-muted">{formatIstDate(b.starts_at)}, {formatIstTime(b.starts_at)} · {b.code}</span>
              </span>
              <span className="text-right text-sm">
                <span className="block font-semibold text-plum">{formatPaise(b.total_paise)}</span>
                <span className="block text-muted">{STATUS_LABEL[b.status]}</span>
              </span>
            </Link>
          </li>
        ))}
        {!rows.length && <li className="card p-6 text-center text-muted">No bookings yet. <Link href="/designs" className="link">Choose a design</Link>.</li>}
      </ul>
      <div className="mt-8"><SignOutButton /></div>
    </>
  );
}

export default function AccountPage() {
  return (
    <div className="container-v max-w-2xl py-8 md:py-12">
      <h1 className="text-[2.5rem] md:text-5xl">My bookings</h1>
      <Suspense fallback={<p className="mt-4 text-muted">Loading…</p>}>
        <Bookings />
      </Suspense>
    </div>
  );
}
