import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { getTicket, TICKET_STATUS_LABEL } from "@/server/support";
import { requireCustomerPage } from "@/components/account/gate";
import { AccountShell } from "@/components/account/AccountShell";
import { ActionForm } from "@/components/admin/ActionForm";
import { AdaptiveSkeleton } from "@/components/site/AdaptiveSkeleton";
import { replyCustomerTicketAction } from "../../actions";
import { formatIstDate, formatIstTime } from "@/lib/time";

export const metadata: Metadata = { title: "Support ticket", robots: { index: false } };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> };

async function Ticket({ params, searchParams }: Props) {
  await connection();
  const me = await requireCustomerPage();
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getTicket(await getDb(), id, { customerId: me.id });
  if (!data) notFound();
  const { ticket: t, messages } = data;
  return (
    <AccountShell customer={me} tab="support">
      <Link href="/account/support" className="link tap-link text-sm">
        ← All tickets
      </Link>
      <div className="mt-1 flex items-start justify-between gap-3">
        <h2 className="text-2xl">{t.subject}</h2>
        <span className="flex-none rounded-full bg-blush px-2.5 py-0.5 text-xs font-semibold text-plum">{TICKET_STATUS_LABEL[t.status]}</span>
      </div>
      <p className="text-xs text-muted">
        {t.code}
        {t.booking_code ? ` · booking ${t.booking_code}` : ""}
      </p>
      {created && (
        <p className="mt-3 rounded-[var(--radius-sm)] bg-[#eef6f1] px-4 py-2 text-sm text-success" role="status">
          Ticket sent. Our team replies here and by email, usually within a working day.
        </p>
      )}
      <ol className="mt-5 space-y-3" aria-label="Conversation">
        {messages.map((m) => {
          const mine = m.author_type === "customer";
          return (
            <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-[var(--radius-md)] px-4 py-3 text-sm ${mine ? "bg-plum text-ivory" : "card"}`}>
                <p className={`text-xs font-semibold ${mine ? "text-blush" : "text-rose-deep"}`}>{mine ? "You" : `${m.author_name || "VAISHORA"} · VAISHORA support`}</p>
                <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p>
                <p className={`mt-1 text-[0.7rem] ${mine ? "text-blush/80" : "text-muted"}`}>
                  {formatIstDate(m.created_at)}, {formatIstTime(m.created_at)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {t.status === "closed" ? (
        <p className="card mt-6 p-4 text-sm text-muted">This ticket is closed. Raise a new one if you need more help.</p>
      ) : (
        <>
          <ActionForm action={replyCustomerTicketAction} submitLabel="Send reply" pendingLabel="Sending…" className="card mt-6 p-4">
            <input type="hidden" name="ticketId" value={t.id} />
            <div className="field">
              <label htmlFor="body">{t.status === "resolved" ? "Still need help? Reply to reopen" : "Reply"}</label>
              <textarea id="body" name="body" className="input min-h-24" required minLength={2} maxLength={3000} />
            </div>
          </ActionForm>
          <ActionForm action={replyCustomerTicketAction} submitLabel="Close ticket — all sorted" className="mt-3">
            <input type="hidden" name="ticketId" value={t.id} />
            <input type="hidden" name="close" value="1" />
          </ActionForm>
        </>
      )}
    </AccountShell>
  );
}

export default function TicketPage(props: Props) {
  return (
    <Suspense fallback={<AdaptiveSkeleton variant="account" />}>
      <Ticket {...props} />
    </Suspense>
  );
}
