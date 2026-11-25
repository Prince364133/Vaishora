import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { listTickets, TICKET_CATEGORY_LABEL, TICKET_STATUS_LABEL } from "@/server/support";
import { ActionForm } from "@/components/admin/ActionForm";
import { updateInboxAction } from "../../actions";
import { formatPhone, timeAgo } from "@/lib/format";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";
import { KeyedSuspense } from "@/components/skeleton/KeyedSuspense";

export const metadata = { title: "Support" };

const PRIORITY_CLS: Record<string, string> = { urgent: "bg-danger text-ivory", high: "bg-gold/40 text-henna", normal: "bg-blush text-plum", low: "bg-white text-muted border hairline" };

async function Content({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await connection();
  await requireRole(["admin", "staff"]);
  const { view: raw } = await searchParams;
  const view = raw === "done" || raw === "all" || raw === "contact" ? raw : "active";
  const db = await getDb();
  const [tickets, counts, contact] = await Promise.all([
    view === "contact" ? Promise.resolve([]) : listTickets(db, { status: view === "all" ? "all" : view }),
    db.query<{ active: number; waiting: number; open_contact: number }>(
      `SELECT (SELECT count(*)::int FROM support_tickets WHERE status IN ('open','in_progress','awaiting_reply')) AS active,
              (SELECT count(*)::int FROM support_tickets WHERE status = 'open') AS waiting,
              (SELECT count(*)::int FROM support_requests WHERE status = 'open') AS open_contact`,
    ),
    view === "contact"
      ? db.query<{ id: string; name: string; phone: string; booking_code: string | null; message: string; status: string; created_at: string }>(
          `SELECT id, name, phone, booking_code, message, status, created_at FROM support_requests ORDER BY status, created_at DESC LIMIT 100`,
        )
      : Promise.resolve([]),
  ]);
  const c = counts[0];
  const tabs = [
    ["active", `Active (${c.active})`],
    ["done", "Resolved"],
    ["all", "All tickets"],
    ["contact", `Contact form (${c.open_contact})`],
  ] as const;
  return (
    <>
      <p className="mt-1 text-sm text-muted">{c.waiting ? `${c.waiting} ticket${c.waiting > 1 ? "s" : ""} waiting for a reply from the team.` : "No tickets waiting for a reply."}</p>
      <nav className="scroller mt-4 gap-2" aria-label="Filter">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/admin/support?view=${k}`} aria-current={view === k ? "page" : undefined} className="chip aria-[current=page]:border-plum aria-[current=page]:bg-plum aria-[current=page]:text-ivory">
            {l}
          </Link>
        ))}
      </nav>
      {view === "contact" ? (
        <ul className="mt-4 space-y-3">
          {contact.map((r) => (
            <li key={r.id} className="card p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold">
                  {r.name} · <a className="link" href={`tel:${r.phone}`}>{formatPhone(r.phone)}</a>
                  {r.booking_code && <span className="text-muted"> · {r.booking_code}</span>}
                </p>
                <span className="text-xs text-muted">{timeAgo(r.created_at)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap">{r.message}</p>
              <ActionForm action={updateInboxAction} submitLabel={r.status === "open" ? "Mark resolved" : "Reopen"} className="[&>div]:mt-2">
                <input type="hidden" name="table" value="support_requests" />
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="status" value={r.status === "open" ? "resolved" : "open"} />
              </ActionForm>
            </li>
          ))}
          {!contact.length && <li className="card p-6 text-center text-muted">No contact form messages.</li>}
        </ul>
      ) : (
        <ul className="mt-4 space-y-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link href={`/admin/support/${t.id}`} className="card block p-4 hover:shadow-md">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold text-plum-ink">{t.subject}</p>
                  <div className="flex gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${PRIORITY_CLS[t.priority]}`}>{t.priority}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.status === "open" ? "bg-rose-deep text-ivory" : "bg-blush text-plum"}`}>
                      {t.status === "awaiting_reply" ? "Waiting for artist" : TICKET_STATUS_LABEL[t.status]}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {t.code} · {t.requester_name} ({t.artist_id ? "artist" : "customer"}) · {TICKET_CATEGORY_LABEL[t.category]}
                  {t.booking_code ? ` · ${t.booking_code}` : ""} · {t.message_count} message{t.message_count > 1 ? "s" : ""} · updated {timeAgo(t.updated_at)}
                </p>
              </Link>
            </li>
          ))}
          {!tickets.length && <li className="card p-6 text-center text-muted">No tickets here.</li>}
        </ul>
      )}
    </>
  );
}

export default function SupportAdminPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  return (
    <>
      <h1 className="text-[2.25rem] sm:text-4xl">Support</h1>
      <KeyedSuspense fallback={<AdaptiveSkeleton />}>
        <Content searchParams={searchParams} />
      </KeyedSuspense>
    </>
  );
}
