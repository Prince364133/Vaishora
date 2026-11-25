import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { getTicket, TICKET_CATEGORY_LABEL, TICKET_PRIORITIES, TICKET_STATUS_LABEL, TICKET_STATUSES } from "@/server/support";
import { ActionForm } from "@/components/admin/ActionForm";
import { adminReplyTicketAction } from "../../../actions";
import { formatIstDate, formatIstTime } from "@/lib/time";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";

export const metadata = { title: "Ticket" };

async function Ticket({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireRole(["admin", "staff"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await getDb();
  const data = await getTicket(db, id);
  if (!data) notFound();
  const { ticket: t, messages } = data;
  const booking = t.booking_code ? (await db.query<{ id: string }>(`SELECT id FROM bookings WHERE code = $1`, [t.booking_code]))[0] : undefined;
  return (
    <div className="max-w-3xl">
      <Link href="/admin/support" className="link tap-link text-sm">All tickets</Link>
      <h1 className="mt-1 text-[2rem] sm:text-4xl">{t.subject}</h1>
      <p className="mt-1 text-sm text-muted">
        {t.code} · {TICKET_CATEGORY_LABEL[t.category]} · {TICKET_STATUS_LABEL[t.status]} · priority {t.priority}
      </p>
      <p className="mt-1 text-sm">
        From {t.artist_id ? <Link className="link" href={`/admin/artists/${t.artist_id}`}>{t.requester_name}</Link> : <>{t.requester_name} (customer)</>}
        {t.requester_contact && <span className="text-muted [overflow-wrap:anywhere]"> · {t.requester_contact}</span>}
        {t.booking_code && (
          <>
            {" · "}
            {booking ? <Link className="link" href={`/admin/bookings/${booking.id}`}>{t.booking_code}</Link> : t.booking_code}
          </>
        )}
      </p>
      <ol className="mt-5 space-y-3">
        {messages.map((m) => {
          const team = m.author_type === "admin";
          return (
            <li key={m.id} className={`flex ${team ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-[var(--radius-md)] px-4 py-3 text-sm ${team ? "bg-plum text-ivory" : "card"}`}>
                <p className={`text-xs font-semibold ${team ? "text-blush" : "text-rose-deep"}`}>{m.author_name || (team ? "Team" : "Artist")}{team ? " · team" : ""}</p>
                <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p>
                <p className={`mt-1 text-[0.7rem] ${team ? "text-blush/80" : "text-muted"}`}>{formatIstDate(m.created_at)}, {formatIstTime(m.created_at)}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <ActionForm action={adminReplyTicketAction} submitLabel="Send / update" className="card mt-6 p-4">
        <input type="hidden" name="ticketId" value={t.id} />
        <div className="field">
          <label htmlFor="body">Reply to the artist <span className="font-normal text-muted">(emailed to them)</span></label>
          <textarea id="body" name="body" maxLength={3000} className="input min-h-28" />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="label">Set status</span>
            <select name="status" className="input" defaultValue="">
              <option value="">Automatic (waiting for artist after a reply)</option>
              {TICKET_STATUSES.map((s) => <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">Priority</span>
            <select name="priority" className="input" defaultValue="">
              <option value="">Keep ({t.priority})</option>
              {TICKET_PRIORITIES.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
            </select>
          </label>
        </div>
      </ActionForm>
    </div>
  );
}

export default function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <Ticket params={params} />
    </Suspense>
  );
}
