import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { requireArtist } from "@/server/artist-auth";
import { getDb } from "@/server/db";
import { getDashboardStats, getOnboarding, listArtistOrders, Onboarding } from "@/server/artist-portal";
import { artistBalance } from "@/server/ledger";
import { cachedSettings } from "@/server/cached";
import { formatPaise } from "@/lib/money";
import { formatIstDate, formatIstTime } from "@/lib/time";
import { STATUS_LABEL } from "@/lib/booking-status";
import { Badge, StatTile, SupportContact } from "@/components/artist/ui";
import { AdaptiveSkeleton } from "@/components/artist/AdaptiveSkeleton";

function Checklist({ o, title }: { o: Onboarding; title: string }) {
  const pct = Math.round((o.done / o.total) * 100);
  return (
    <section className="card p-5" aria-labelledby="setup-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="setup-title" className="text-2xl">
          {title}
        </h2>
        <span className="text-sm font-semibold text-plum tabular-nums">
          {o.done}/{o.total}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-blush" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
        <div className="h-full rounded-full bg-plum transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-4 divide-y hairline">
        {o.steps.map((s, i) => (
          <li key={s.key}>
            <Link href={s.href} className="flex min-h-12 items-center gap-3 py-2">
              <span
                className={`grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-bold ${s.done ? "bg-success text-ivory" : "border border-plum/30 text-plum"}`}
                aria-hidden
              >
                {s.done ? "✓" : i + 1}
              </span>
              <span className={`flex-1 text-sm ${s.done ? "text-muted line-through" : "font-semibold text-plum-ink"}`}>{s.label}</span>
              {!s.done && (
                <span className="text-plum" aria-hidden>
                  →
                </span>
              )}
              <span className="sr-only">{s.done ? "done" : "to do"}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

async function Dashboard() {
  await connection();
  const a = await requireArtist();
  const db = await getDb();
  const settings = await cachedSettings();
  const phone = settings.support.phone;
  const onboarding = await getOnboarding(db, a.id);
  const first = a.name.split(" ")[0];

  if (a.status !== "active") {
    const steps = [
      { label: "Application sent", done: true },
      { label: "Verification by our team", done: a.status !== "pending", current: a.status === "pending" },
      { label: a.status === "rejected" ? "Not approved" : "Account approved", done: false },
    ];
    return (
      <>
        <h1 className="text-[2.1rem] sm:text-4xl">Hello, {first}</h1>
        <section className="mt-4 overflow-hidden rounded-[var(--radius-lg)] bg-plum p-5 text-ivory sm:p-6">
          {a.status === "pending" && (
            <>
              <span className="inline-flex rounded-full bg-gold px-2.5 py-0.5 text-xs font-semibold text-plum-ink">Pending verification</span>
              <h2 className="mt-3 text-3xl text-ivory">Your artist account is under verification</h2>
              <p className="mt-2 text-sm text-blush">
                Our team is reviewing your application and work. This usually takes 2–3 working days. We will email {a.email ?? "you"} the moment you are approved.
              </p>
            </>
          )}
          {a.status === "rejected" && (
            <>
              <span className="inline-flex rounded-full bg-gold px-2.5 py-0.5 text-xs font-semibold text-plum-ink">Not approved</span>
              <h2 className="mt-3 text-3xl text-ivory">Your application was not approved</h2>
              {a.rejection_reason && <p className="mt-2 text-sm text-blush">Reason: {a.rejection_reason}</p>}
              <p className="mt-2 text-sm text-blush">
                Your details or work changed?{" "}
                <Link href="/become-an-artist" className="font-semibold text-ivory underline underline-offset-4">
                  Apply again
                </Link>{" "}
                with the same email, or contact our support team.
              </p>
            </>
          )}
          {a.status === "suspended" && (
            <>
              <span className="inline-flex rounded-full bg-gold px-2.5 py-0.5 text-xs font-semibold text-plum-ink">Account paused</span>
              <h2 className="mt-3 text-3xl text-ivory">Your artist account is paused</h2>
              <p className="mt-2 text-sm text-blush">You are not receiving new bookings. Please contact support to restore your account.</p>
            </>
          )}
          <ol className="mt-5 grid gap-2 sm:grid-cols-3">
            {steps.map((s) => (
              <li key={s.label} className={`flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm ${s.current ? "bg-white/15 font-semibold" : "bg-white/5"}`}>
                <span className={`grid h-6 w-6 flex-none place-items-center rounded-full text-xs ${s.done ? "bg-gold text-plum-ink" : "border border-white/40"}`} aria-hidden>
                  {s.done ? "✓" : ""}
                </span>
                {s.label}
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            {phone && (
              <a href={`tel:${phone}`} className="btn btn-on-plum btn-sm">
                Call support
              </a>
            )}
            <Link href="/artist-portal/support" className="btn btn-sm border border-white/30 text-ivory hover:bg-white/10">
              Raise a ticket
            </Link>
          </div>
        </section>
        {a.status === "pending" && (
          <div className="mt-5">
            <Checklist o={{ ...onboarding, steps: onboarding.steps.filter((s) => s.key !== "design"), total: 4, done: onboarding.steps.filter((s) => s.key !== "design" && s.done).length }} title="Get ready while you wait" />
            <p className="mt-2 text-xs text-muted">You can add designs once your account is approved.</p>
          </div>
        )}
      </>
    );
  }

  const [stats, bal, requests, upcoming, reviews] = await Promise.all([
    getDashboardStats(db, a.id),
    artistBalance(db, a.id),
    listArtistOrders(db, a.id, "requests"),
    listArtistOrders(db, a.id, "upcoming"),
    db.query<{ id: string; rating: number; body: string; name: string; design: string; created_at: string }>(
      `SELECT r.id, r.rating, r.body, split_part(c.name, ' ', 1) AS name, d.name AS design, r.created_at
       FROM reviews r JOIN bookings b ON b.id = r.booking_id JOIN customers c ON c.id = r.customer_id JOIN designs d ON d.id = b.design_id
       WHERE r.artist_id = $1 AND r.status = 'published' ORDER BY r.created_at DESC LIMIT 3`,
      [a.id],
    ),
  ]);
  const setupDone = onboarding.done === onboarding.total;
  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{formatIstDate(new Date(), true)}</p>
          <h1 className="text-[2.1rem] sm:text-4xl">Hello, {first}</h1>
        </div>
        <Link href={`/artists/${a.slug}`} className="link tap-link text-sm" target="_blank">
          View my public profile
        </Link>
      </div>

      {!onboarding.bookable && (
        <p className="mt-4 rounded-[var(--radius-md)] border border-gold bg-gold/15 px-4 py-3 text-sm">
          <span className="font-semibold">Customers can’t book you yet.</span> Add your {onboarding.missingForBookable.join(", ")} to start receiving bookings.
        </p>
      )}

      {requests.length > 0 && (
        <Link href="/artist-portal/orders?tab=requests" className="mt-4 flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-rose-deep px-4 py-3 text-ivory">
          <span className="font-semibold">
            {requests.length} new booking request{requests.length > 1 ? "s" : ""} — respond now
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}

      {!setupDone && (
        <div className="mt-5">
          <Checklist o={onboarding} title="Finish setting up" />
        </div>
      )}

      <section className="mt-5" aria-label="This month">
        <h2 className="sr-only">Your numbers</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatTile tone="plum" label="Available to withdraw" value={formatPaise(Math.max(0, bal.available_paise))} hint={bal.pending_payout_paise ? `${formatPaise(bal.pending_payout_paise)} payout in progress` : "Tap to request a payout"} href="/artist-portal/payouts" />
          <StatTile label="Earned this month" value={formatPaise(stats.month_net_paise)} hint={`${formatPaise(stats.month_gross_paise)} in bookings`} />
          <StatTile label="Orders this month" value={String(stats.month_orders)} hint={`${stats.month_completed} completed`} href="/artist-portal/orders" />
          <StatTile label="Upcoming" value={String(stats.upcoming)} hint={stats.awaiting_response ? `${stats.awaiting_response} awaiting your reply` : "confirmed bookings"} href="/artist-portal/orders?tab=upcoming" />
          <StatTile label="Total earned" value={formatPaise(bal.lifetime_net_paise)} hint={`${formatPaise(bal.cash_collected_paise)} collected in cash · ${formatPaise(bal.paid_out_paise)} paid out`} />
          <StatTile label="Rating" value={stats.rating != null ? `★ ${stats.rating}` : "—"} hint={stats.review_count ? `${stats.review_count} reviews` : "no reviews yet"} />
        </div>
        {bal.available_paise < 0 && (
          <p className="mt-3 text-sm text-muted">
            Your balance is {formatPaise(bal.available_paise)}: the platform margin on recent bookings was more than the advance collected online. It is settled from future advances.
          </p>
        )}
      </section>

      <section className="mt-7">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl">Next bookings</h2>
          <Link href="/artist-portal/orders?tab=upcoming" className="link tap-link text-sm">
            All orders
          </Link>
        </div>
        <ul className="mt-3 space-y-2">
          {upcoming.slice(0, 3).map((b) => (
            <li key={b.id}>
              <Link href="/artist-portal/orders?tab=upcoming" className="card flex items-center gap-3 p-4">
                <div className="grid w-14 flex-none place-items-center rounded-[var(--radius-sm)] bg-blush py-1.5 text-center">
                  <span className="text-xs uppercase text-muted">{formatIstDate(b.starts_at).split(" ").slice(0, 2).join(" ")}</span>
                  <span className="text-sm font-semibold text-plum">{formatIstTime(b.starts_at)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-plum-ink">{b.design}</p>
                  <p className="truncate text-sm text-muted">
                    {b.locality} · {b.customer_first}
                  </p>
                </div>
                <Badge tone={b.status === "in_progress" ? "warning" : "success"}>{STATUS_LABEL[b.status]}</Badge>
              </Link>
            </li>
          ))}
          {!upcoming.length && <li className="card p-5 text-center text-sm text-muted">No confirmed bookings coming up.</li>}
        </ul>
      </section>

      {reviews.length > 0 && (
        <section className="mt-7">
          <h2 className="text-2xl">Recent reviews</h2>
          <ul className="mt-3 space-y-2">
            {reviews.map((r) => (
              <li key={r.id} className="card p-4 text-sm">
                <p className="text-gold" aria-label={`${r.rating} out of 5`}>
                  {"★".repeat(r.rating)}
                  <span className="text-gold/30">{"★".repeat(5 - r.rating)}</span>
                </p>
                {r.body && <p className="mt-1 text-plum-ink">“{r.body}”</p>}
                <p className="mt-1 text-xs text-muted">
                  {r.name || "Customer"} · {r.design} · {formatIstDate(r.created_at)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Shortcuts">
        {[
          ["/artist-portal/designs/new", "Add a design"],
          ["/artist-portal/schedule", "Working hours"],
          ["/artist-portal/payouts", "Payouts"],
          ["/artist-portal/support", "Support"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="card flex min-h-14 items-center justify-center px-3 text-center text-sm font-semibold text-plum hover:bg-blush/50">
            {label}
          </Link>
        ))}
      </section>
      {phone && (
        <div className="mt-6 text-sm text-muted">
          <p>Questions? Our team is here to help.</p>
          <SupportContact phone={phone} compact />
        </div>
      )}
    </>
  );
}

export default function ArtistHome() {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}
