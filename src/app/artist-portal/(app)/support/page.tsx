import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireArtist } from "@/server/artist-auth";
import { getDb } from "@/server/db";
import { listTickets, TICKET_CATEGORIES, TICKET_CATEGORY_LABEL, TICKET_STATUS_LABEL } from "@/server/support";
import { cachedSettings } from "@/server/cached";
import { ActionForm } from "@/components/admin/ActionForm";
import { Badge, PageHeader, ticketTone } from "@/components/artist/ui";
import { createTicketAction } from "../../actions";
import { formatPhone, timeAgo } from "@/lib/format";
import { AdaptiveSkeleton } from "@/components/artist/AdaptiveSkeleton";

export const metadata: Metadata = { title: "Support" };

async function Support() {
  await connection();
  const a = await requireArtist();
  const [tickets, settings] = await Promise.all([listTickets(await getDb(), { artistId: a.id }), cachedSettings()]);
  const phone = settings.support.phone;
  return (
    <>
      <PageHeader title="Support" back={{ href: "/artist-portal/profile", label: "Profile" }} subtitle="Raise a ticket and track it here. Our team replies within one working day." />
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

      <section>
        <h2 className="text-2xl">Your tickets</h2>
        <ul className="mt-3 space-y-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link href={`/artist-portal/support/${t.id}`} className="card block p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-plum-ink">{t.subject}</p>
                  <Badge tone={ticketTone(t.status)}>{TICKET_STATUS_LABEL[t.status]}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {t.code} · {TICKET_CATEGORY_LABEL[t.category]} · updated {timeAgo(t.updated_at)}
                </p>
              </Link>
            </li>
          ))}
          {!tickets.length && <li className="text-sm text-muted">You have not raised any tickets.</li>}
        </ul>
      </section>

      <section className="mt-8" id="new">
        <h2 className="text-2xl">Raise a ticket</h2>
        <ActionForm action={createTicketAction} submitLabel="Send ticket" pendingLabel="Sending…" className="card mt-3 space-y-4 p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="category">Topic</label>
              <select id="category" name="category" className="input" defaultValue={a.status === "active" ? "booking" : "account"}>
                {TICKET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {TICKET_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="priority">How urgent?</label>
              <select id="priority" name="priority" className="input" defaultValue="normal">
                <option value="low">Not urgent</option>
                <option value="normal">Normal</option>
                <option value="high">High — affects a booking soon</option>
                <option value="urgent">Urgent — booking today</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="subject">Subject</label>
            <input id="subject" name="subject" className="input" required minLength={5} maxLength={120} placeholder="e.g. Customer address is incomplete" />
          </div>
          <div className="field">
            <label htmlFor="booking_code">
              Booking reference <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="booking_code" name="booking_code" className="input uppercase" maxLength={20} placeholder="VSH-XXXXXX" autoCapitalize="characters" spellCheck={false} />
          </div>
          <div className="field">
            <label htmlFor="body">What happened?</label>
            <textarea id="body" name="body" className="input min-h-32" required minLength={10} maxLength={3000} />
          </div>
        </ActionForm>
      </section>
    </>
  );
}

export default function SupportPage() {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <Support />
    </Suspense>
  );
}
