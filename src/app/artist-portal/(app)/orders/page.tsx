import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireArtist } from "@/server/artist-auth";
import { getDb } from "@/server/db";
import { listArtistOrders, OrderFilter } from "@/server/artist-portal";
import { cachedSettings } from "@/server/cached";
import { ActionForm } from "@/components/admin/ActionForm";
import { Badge, EmptyState, NotActiveNotice, PageHeader } from "@/components/artist/ui";
import { respondToOrderAction } from "../../actions";
import { STATUS_LABEL, BookingStatus } from "@/lib/booking-status";
import { formatPaise } from "@/lib/money";
import { formatDuration, formatIstDate, formatIstTime } from "@/lib/time";
import { formatPhone } from "@/lib/format";
import { AdaptiveSkeleton } from "@/components/artist/AdaptiveSkeleton";
import { KeyedSuspense } from "@/components/skeleton/KeyedSuspense";

export const metadata: Metadata = { title: "Orders" };

const TABS: { key: OrderFilter; label: string }[] = [
  { key: "requests", label: "Requests" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
];

const tone = (s: BookingStatus) => (s === "completed" || s === "confirmed" ? "success" : s === "awaiting_artist_confirmation" || s === "in_progress" ? "warning" : s.startsWith("refund") || s === "cancelled" ? "danger" : "neutral");

function Hidden({ id, decision }: { id: string; decision: string }) {
  return (
    <>
      <input type="hidden" name="bookingId" value={id} />
      <input type="hidden" name="decision" value={decision} />
    </>
  );
}

const DONE: Record<string, string> = {
  accept: "Booking accepted. The customer’s address and phone are now shown below.",
  reject: "Booking declined. Our team will reassign it to another artist.",
  start: "Session started. Mark it completed when you finish.",
  complete: "Session completed. Your earning has been added to Payouts.",
};

async function Orders({ searchParams }: { searchParams: Promise<{ tab?: string; done?: string }> }) {
  await connection();
  const a = await requireArtist();
  const settings = await cachedSettings();
  if (a.status !== "active")
    return (
      <>
        <PageHeader title="Orders" />
        <NotActiveNotice status={a.status} phone={settings.support.phone} />
      </>
    );
  const { tab: raw, done } = await searchParams;
  const db = await getDb();
  const requestsCount = (await listArtistOrders(db, a.id, "requests")).length;
  const tab: OrderFilter = TABS.some((t) => t.key === raw) ? (raw as OrderFilter) : requestsCount ? "requests" : "upcoming";
  const rows = await listArtistOrders(db, a.id, tab);
  return (
    <>
      <PageHeader title="Orders" subtitle="Times are IST. The customer’s address and phone appear once you accept." />
      {done && DONE[done] && (
        <p className="mb-4 rounded-[var(--radius-md)] bg-[#eef6f1] px-4 py-3 text-sm text-success" role="status">
          {DONE[done]}
        </p>
      )}
      <nav className="mb-4 grid grid-cols-3 rounded-[var(--radius-md)] bg-blush p-1" aria-label="Order filter">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/artist-portal/orders?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] text-sm font-semibold ${tab === t.key ? "bg-white text-plum shadow-sm" : "text-muted"}`}
          >
            {t.label}
            {t.key === "requests" && requestsCount > 0 && <span className="rounded-full bg-rose-deep px-1.5 text-xs leading-5 text-ivory">{requestsCount}</span>}
          </Link>
        ))}
      </nav>
      {!rows.length ? (
        <EmptyState
          title={tab === "requests" ? "No new requests" : tab === "upcoming" ? "No upcoming bookings" : "No past bookings yet"}
          text={tab === "past" ? "Completed and cancelled bookings will appear here." : "Keep your working hours and designs up to date to receive more bookings."}
          action={
            <Link href="/artist-portal/schedule" className="btn btn-secondary btn-sm">
              Check working hours
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((b) => {
            const opts = b.options as { hands?: string; side?: string; coverage?: string; addons?: string[] };
            return (
              <li key={b.id} className="card p-4 [overflow-wrap:anywhere] sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-[1.6rem] leading-tight text-plum">
                      {formatIstDate(b.starts_at)}, {formatIstTime(b.starts_at)}
                    </p>
                    <p className="text-xs text-muted">
                      {b.code} · {formatDuration(b.duration_minutes)}
                    </p>
                  </div>
                  <Badge tone={tone(b.status)}>{STATUS_LABEL[b.status]}</Badge>
                </div>
                <dl className="mt-3 grid gap-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-24 flex-none text-muted">Design</dt>
                    <dd className="font-semibold">
                      {b.design}
                      {b.people_count > 1 ? ` · ${b.people_count} people` : ""}
                    </dd>
                  </div>
                  {(opts.hands || opts.coverage) && (
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted">Options</dt>
                      <dd>{[opts.hands, opts.side, opts.coverage, ...(opts.addons ?? [])].filter(Boolean).join(", ").replace(/_/g, " ")}</dd>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <dt className="w-24 flex-none text-muted">Where</dt>
                    <dd>{b.address_line ? `${b.address_line}, ${b.locality}${b.landmark ? ` (near ${b.landmark})` : ""}` : b.locality}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 flex-none text-muted">Customer</dt>
                    <dd>
                      {b.customer_first}
                      {b.customer_phone && (
                        <>
                          {" · "}
                          <a className="link" href={`tel:${b.customer_phone}`}>
                            {formatPhone(b.customer_phone)}
                          </a>
                        </>
                      )}
                    </dd>
                  </div>
                  {b.instructions && (
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted">Directions</dt>
                      <dd>{b.instructions}</dd>
                    </div>
                  )}
                  {b.special_requirements && (
                    <div className="flex gap-2">
                      <dt className="w-24 flex-none text-muted">Requests</dt>
                      <dd>{b.special_requirements}</dd>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <dt className="w-24 flex-none text-muted">Amount</dt>
                    <dd>
                      {formatPaise(b.total_paise)} <span className="text-muted">(advance {formatPaise(b.advance_paise)} paid online · collect {formatPaise(b.total_paise - b.advance_paise)})</span>
                    </dd>
                  </div>
                </dl>
                {b.address_line && b.status !== "completed" && (
                  <a
                    className="link tap-link mt-2 inline-flex text-sm"
                    target="_blank"
                    rel="noreferrer"
                    href={b.lat != null && b.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.address_line}, ${b.locality}, Hyderabad`)}`}
                  >
                    {b.lat != null ? "Directions in Google Maps" : "Open in Maps"}
                  </a>
                )}
                <div className="flex flex-wrap gap-x-3">
                  {b.status === "awaiting_artist_confirmation" && (
                    <>
                      <ActionForm action={respondToOrderAction} submitLabel="Accept booking" pendingLabel="Accepting…">
                        <Hidden id={b.id} decision="accept" />
                      </ActionForm>
                      <ActionForm action={respondToOrderAction} submitLabel="Decline" pendingLabel="Declining…" danger>
                        <Hidden id={b.id} decision="reject" />
                      </ActionForm>
                    </>
                  )}
                  {b.status === "confirmed" && (
                    <ActionForm action={respondToOrderAction} submitLabel="Start session" pendingLabel="Starting…">
                      <Hidden id={b.id} decision="start" />
                    </ActionForm>
                  )}
                  {b.status === "in_progress" && (
                    <ActionForm action={respondToOrderAction} submitLabel="Mark completed" pendingLabel="Saving…">
                      <Hidden id={b.id} decision="complete" />
                    </ActionForm>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export default function OrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string; done?: string }> }) {
  return (
    <KeyedSuspense fallback={<AdaptiveSkeleton />}>
      <Orders searchParams={searchParams} />
    </KeyedSuspense>
  );
}
