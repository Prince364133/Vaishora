import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { listTickets, TICKET_STATUS_LABEL } from "@/server/support";
import { cachedSettings } from "@/server/cached";
import { requireCustomerPage } from "@/components/account/gate";
import { AccountShell } from "@/components/account/AccountShell";
import { ActionForm } from "@/components/admin/ActionForm";
import { AdaptiveSkeleton } from "@/components/site/AdaptiveSkeleton";
import { createCustomerTicketAction } from "../actions";
import { formatPhone, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Support", robots: { index: false } };

const CATS = [
  ["booking", "A booking"],
  ["payment", "Payment or refund"],
  ["account", "My account"],
  ["other", "Something else"],
] as const;

const STATUS_TEXT: Record<string, string> = { ...TICKET_STATUS_LABEL, awaiting_reply: "Reply from our team" };

async function Support({ searchParams }: { searchParams: Promise<{ booking?: string }> }) {
  await connection();
  const me = await requireCustomerPage();
  const db = await getDb();
  const [{ booking }, tickets, bookings, settings] = await Promise.all([
    searchParams,
    listTickets(db, { customerId: me.id }),
    db.query<{ code: string; design: string }>(
      `SELECT b.code, d.name AS design FROM bookings b JOIN designs d ON d.id = b.design_id WHERE b.customer_id = $1 AND b.status <> 'expired' ORDER BY b.starts_at DESC LIMIT 30`,
      [me.id],
    ),
    cachedSettings(),
  ]);
  const phone = settings.support.phone;
  return (
    <AccountShell customer={me} tab="support" badge={{ support: tickets.filter((t) => t.status === "awaiting_reply").length }}>
      {phone && (
        <a href={`tel:${phone}`} className="card mb-5 flex items-center justify-between gap-3 p-4">
          <span>
            <span className="block font-semibold text-plum-ink">Urgent? Call us</span>
            <span className="text-sm text-muted">
              {formatPhone(phone)}
              {settings.support.hours ? ` · ${settings.support.hours}` : ""}
            </span>
          </span>
          <span className="btn btn-secondary btn-sm">Call</span>
        </a>
      )}
      <h2 className="text-2xl">Your tickets</h2>
      <ul className="mt-3 space-y-2">
        {tickets.map((t) => (
          <li key={t.id}>
            <Link href={`/account/support/${t.id}`} className="card block p-4 hover:border-rose">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-plum-ink">{t.subject}</p>
                <span
                  className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    t.status === "awaiting_reply" ? "bg-gold/25 text-henna" : t.status === "resolved" || t.status === "closed" ? "bg-[#e6f2ea] text-success" : "bg-blush text-plum"
                  }`}
                >
                  {STATUS_TEXT[t.status]}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {t.code}
                {t.booking_code ? ` · ${t.booking_code}` : ""} · updated {timeAgo(t.updated_at)}
              </p>
            </Link>
          </li>
        ))}
        {!tickets.length && <li className="text-sm text-muted">You have not raised any tickets.</li>}
      </ul>

      <h2 className="mt-8 text-2xl" id="new">
        Raise a ticket
      </h2>
      <ActionForm action={createCustomerTicketAction} submitLabel="Send ticket" pendingLabel="Sending…" className="card mt-3 space-y-4 p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="category">It is about</label>
            <select id="category" name="category" className="input" defaultValue="booking">
              {CATS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="booking_code">
              Booking <span className="font-normal text-muted">(optional)</span>
            </label>
            <select id="booking_code" name="booking_code" className="input" defaultValue={booking ?? ""}>
              <option value="">Not about a booking</option>
              {bookings.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code} — {b.design}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="subject">Subject</label>
          <input id="subject" name="subject" className="input" required minLength={5} maxLength={120} placeholder="e.g. Can I change my booking time?" />
        </div>
        <div className="field">
          <label htmlFor="body">How can we help?</label>
          <textarea id="body" name="body" className="input min-h-32" required minLength={10} maxLength={3000} />
        </div>
      </ActionForm>
    </AccountShell>
  );
}

export default function SupportPage({ searchParams }: { searchParams: Promise<{ booking?: string }> }) {
  return (
    <Suspense fallback={<AdaptiveSkeleton variant="account" />}>
      <Support searchParams={searchParams} />
    </Suspense>
  );
}
