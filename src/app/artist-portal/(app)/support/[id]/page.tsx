import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireArtist } from "@/server/artist-auth";
import { getDb } from "@/server/db";
import { getTicket, TICKET_CATEGORY_LABEL, TICKET_STATUS_LABEL } from "@/server/support";
import { ActionForm } from "@/components/admin/ActionForm";
import { Badge, PageHeader, ticketTone } from "@/components/artist/ui";
import { replyTicketAction } from "../../../actions";
import { formatIstDate, formatIstTime } from "@/lib/time";
import { AdaptiveSkeleton } from "@/components/artist/AdaptiveSkeleton";

export const metadata: Metadata = { title: "Ticket" };

async function Ticket({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  await connection();
  const a = await requireArtist();
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getTicket(await getDb(), id, a.id);
  if (!data) notFound();
  const { ticket: t, messages } = data;
  const closed = t.status === "closed";
  return (
    <>
      <PageHeader
        title={t.subject}
        back={{ href: "/artist-portal/support", label: "Support" }}
        subtitle={`${t.code} · ${TICKET_CATEGORY_LABEL[t.category]}${t.booking_code ? ` · ${t.booking_code}` : ""}`}
        action={<Badge tone={ticketTone(t.status)}>{TICKET_STATUS_LABEL[t.status]}</Badge>}
      />
      {created && (
        <p className="mb-4 rounded-[var(--radius-md)] bg-[#eef6f1] px-4 py-3 text-sm text-success" role="status">
          Ticket sent. We’ll reply here and by email.
        </p>
      )}
      <ol className="space-y-3" aria-label="Conversation">
        {messages.map((m) => {
          const mine = m.author_type === "artist";
          return (
            <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-[var(--radius-md)] px-4 py-3 text-sm ${mine ? "bg-plum text-ivory" : "card"}`}>
                <p className={`text-xs font-semibold ${mine ? "text-blush" : "text-rose-deep"}`}>{mine ? "You" : `${m.author_name || "VAISHORA team"} · VAISHORA`}</p>
                <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p>
                <p className={`mt-1 text-[0.7rem] ${mine ? "text-blush/80" : "text-muted"}`}>
                  {formatIstDate(m.created_at)}, {formatIstTime(m.created_at)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {closed ? (
        <p className="mt-6 card p-4 text-sm text-muted">This ticket is closed. Raise a new ticket if you need more help.</p>
      ) : (
        <>
          <ActionForm action={replyTicketAction} submitLabel="Send reply" pendingLabel="Sending…" className="card mt-6 p-4">
            <input type="hidden" name="ticketId" value={t.id} />
            <div className="field">
              <label htmlFor="body">{t.status === "resolved" ? "Still need help? Reply to reopen" : "Reply"}</label>
              <textarea id="body" name="body" className="input min-h-24" required minLength={2} maxLength={3000} />
            </div>
          </ActionForm>
          <ActionForm action={replyTicketAction} submitLabel="Close ticket — issue solved" className="mt-3 [&_button]:btn-secondary">
            <input type="hidden" name="ticketId" value={t.id} />
            <input type="hidden" name="close" value="1" />
          </ActionForm>
        </>
      )}
    </>
  );
}

export default function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <Ticket params={params} searchParams={searchParams} />
    </Suspense>
  );
}
