import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireArtist } from "@/server/artist-auth";
import { getDb } from "@/server/db";
import { artistBalance, marginFor } from "@/server/ledger";
import { cachedSettings } from "@/server/cached";
import { maskAccount } from "@/server/vault";
import { ActionForm } from "@/components/admin/ActionForm";
import { Badge, PageHeader, StatTile } from "@/components/artist/ui";
import { requestPayoutAction, saveBankAction } from "../../actions";
import { formatPaise } from "@/lib/money";
import { formatIstDate } from "@/lib/time";
import { percentFromBp } from "@/lib/format";
import { AdaptiveSkeleton } from "@/components/artist/AdaptiveSkeleton";

export const metadata: Metadata = { title: "Payouts" };

const PAYOUT = { requested: ["Requested", "warning"], approved: ["Approved — sending", "warning"], paid: ["Paid", "success"], rejected: ["Rejected", "danger"] } as const;

async function Payouts() {
  await connection();
  const a = await requireArtist();
  const db = await getDb();
  const [bal, bank, payouts, ledger, settings, marginBp] = await Promise.all([
    artistBalance(db, a.id),
    db.query<{ holder_name: string; account_last4: string; ifsc: string; bank_name: string; upi_id: string | null; updated_at: string; verified_at: string | null }>(
      `SELECT holder_name, account_last4, ifsc, bank_name, upi_id, updated_at, verified_at FROM artist_bank_accounts WHERE artist_id = $1`,
      [a.id],
    ),
    db.query<{ id: string; amount_paise: number; status: keyof typeof PAYOUT; reference: string | null; admin_note: string | null; requested_at: string; processed_at: string | null }>(
      `SELECT id, amount_paise, status, reference, admin_note, requested_at, processed_at FROM payout_requests WHERE artist_id = $1 ORDER BY requested_at DESC LIMIT 50`,
      [a.id],
    ),
    db.query<{ id: string; kind: string; amount_paise: number; gross_paise: number; margin_paise: number; advance_paise: number; cash_paise: number; note: string; created_at: string; code: string | null }>(
      `SELECT l.id::text, l.kind, l.amount_paise, l.gross_paise, l.margin_paise, l.advance_paise, l.cash_paise, l.note, l.created_at, b.code
       FROM artist_ledger l LEFT JOIN bookings b ON b.id = l.booking_id WHERE l.artist_id = $1 ORDER BY l.created_at DESC, l.id DESC LIMIT 100`,
      [a.id],
    ),
    cachedSettings(),
    marginFor(db, a.id),
  ]);
  const b = bank[0];
  const open = payouts.find((p) => p.status === "requested" || p.status === "approved");
  const canRequest = a.status === "active" && !!b && !open && bal.available_paise >= settings.payout_min_paise;
  return (
    <>
      <PageHeader title="Payouts" back={{ href: "/artist-portal", label: "Home" }} subtitle="Your earnings, withdrawals and bank account." />

      <div className="grid grid-cols-2 gap-3">
        <StatTile tone="plum" label="Available to withdraw" value={formatPaise(Math.max(0, bal.available_paise))} hint={bal.available_paise < 0 ? `You owe ${formatPaise(-bal.available_paise)} (settled from future advances)` : `Minimum payout ${formatPaise(settings.payout_min_paise)}`} />
        <StatTile label="In progress" value={formatPaise(bal.pending_payout_paise)} hint="requested, not yet paid" />
        <StatTile label="Paid to your bank" value={formatPaise(bal.paid_out_paise)} hint="all time" />
        <StatTile label="Total earned" value={formatPaise(bal.lifetime_net_paise)} hint={`after ${percentFromBp(marginBp)} platform margin`} />
      </div>

      <details className="mt-3 rounded-[var(--radius-md)] bg-blush/60 p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-plum">How your earnings work</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-plum-ink">
          <li>Customers pay an advance online to VAISHORA and the rest to you in cash after the session.</li>
          <li>When you mark a booking completed, VAISHORA keeps its {percentFromBp(marginBp)} margin on the booking total, and the rest of the advance is added to your balance.</li>
          <li>If the margin is more than the advance, the difference is taken from your next earnings.</li>
          <li>Request a payout any time your balance is at least {formatPaise(settings.payout_min_paise)}. Payouts are usually sent within 2 working days.</li>
        </ul>
      </details>

      <section className="mt-6">
        <h2 className="text-2xl">Withdraw</h2>
        {open ? (
          <p className="card mt-3 p-4 text-sm">
            Your payout of <strong>{formatPaise(open.amount_paise)}</strong> requested on {formatIstDate(open.requested_at)} is {open.status === "approved" ? "approved and being sent" : "waiting for approval"}. You’ll get an email once it reaches your bank.
          </p>
        ) : a.status !== "active" ? (
          <p className="card mt-3 p-4 text-sm text-muted">Payouts open once your account is verified.</p>
        ) : !b ? (
          <p className="card mt-3 p-4 text-sm text-muted">Add your bank account below to request payouts.</p>
        ) : (
          <ActionForm action={requestPayoutAction} submitLabel="Request payout" pendingLabel="Requesting…" className="card mt-3 p-4 sm:p-5">
            <div className="field max-w-xs">
              <label htmlFor="amount">Amount (₹)</label>
              <input
                id="amount"
                name="amount"
                type="number"
                inputMode="decimal"
                min={settings.payout_min_paise / 100}
                max={Math.max(0, bal.available_paise) / 100}
                step="0.01"
                required
                disabled={!canRequest}
                defaultValue={canRequest ? Math.floor(bal.available_paise / 100) : undefined}
                className="input"
              />
              <p className="field-hint">
                To {b.holder_name} · {maskAccount(b.account_last4)} · {b.ifsc}
              </p>
            </div>
            {!canRequest && <p className="mt-2 text-sm text-muted">You can request a payout when your available balance reaches {formatPaise(settings.payout_min_paise)}.</p>}
          </ActionForm>
        )}
      </section>

      <section id="bank" className="mt-8 scroll-mt-20">
        <h2 className="text-2xl">Bank account</h2>
        {b && (
          <div className="card mt-3 flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
            <div>
              <p className="font-semibold text-plum-ink">
                {b.holder_name} · {maskAccount(b.account_last4)}
              </p>
              <p className="text-muted">
                {b.bank_name ? `${b.bank_name} · ` : ""}
                {b.ifsc}
                {b.upi_id ? ` · UPI ${b.upi_id}` : ""}
              </p>
            </div>
            {b.verified_at ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Verification pending</Badge>}
          </div>
        )}
        <details className="mt-3" open={!b}>
          <summary className="link tap-link cursor-pointer text-sm">{b ? "Change bank account" : "Add bank account"}</summary>
          <ActionForm action={saveBankAction} submitLabel="Save bank account" className="card mt-3 space-y-4 p-4 sm:p-5">
            <div className="field">
              <label htmlFor="holder_name">Account holder name</label>
              <input id="holder_name" name="holder_name" className="input" required maxLength={80} autoComplete="name" autoCapitalize="words" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="field">
                <label htmlFor="account">Account number</label>
                <input id="account" name="account" className="input" required inputMode="numeric" pattern="[0-9 ]{9,22}" autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="account_confirm">Re-enter account number</label>
                <input id="account_confirm" name="account_confirm" className="input" required inputMode="numeric" pattern="[0-9 ]{9,22}" autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="ifsc">IFSC code</label>
                <input id="ifsc" name="ifsc" className="input uppercase" required maxLength={11} placeholder="HDFC0001234" autoCapitalize="characters" spellCheck={false} />
              </div>
              <div className="field">
                <label htmlFor="bank_name">
                  Bank name <span className="font-normal text-muted">(optional)</span>
                </label>
                <input id="bank_name" name="bank_name" className="input" maxLength={80} />
              </div>
              <div className="field sm:col-span-2">
                <label htmlFor="upi_id">
                  UPI ID <span className="font-normal text-muted">(optional)</span>
                </label>
                <input id="upi_id" name="upi_id" className="input" maxLength={80} placeholder="name@okhdfc" autoCapitalize="none" spellCheck={false} />
              </div>
            </div>
            <p className="text-xs text-muted">Your account number is encrypted and only the last 4 digits are shown. Changing it sends you an email alert and needs re-verification before the next payout.</p>
          </ActionForm>
        </details>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl">Payout history</h2>
        <ul className="mt-3 space-y-2">
          {payouts.map((p) => {
            const [label, tone] = PAYOUT[p.status];
            return (
              <li key={p.id} className="card p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-plum-ink tabular-nums">{formatPaise(p.amount_paise)}</span>
                  <Badge tone={tone}>{label}</Badge>
                </div>
                <p className="mt-1 text-muted">
                  Requested {formatIstDate(p.requested_at)}
                  {p.processed_at ? ` · ${p.status === "paid" ? "paid" : "closed"} ${formatIstDate(p.processed_at)}` : ""}
                  {p.reference ? ` · Ref ${p.reference}` : ""}
                </p>
                {p.admin_note && <p className="mt-1">{p.admin_note}</p>}
              </li>
            );
          })}
          {!payouts.length && <li className="text-sm text-muted">No payouts yet.</li>}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl">Earnings activity</h2>
        <ul className="mt-3 divide-y hairline card">
          {ledger.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 p-4 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-plum-ink">
                  {l.kind === "booking" ? `Booking ${l.code ?? ""}` : l.kind === "payout" ? "Payout requested" : l.kind === "payout_reversal" ? "Payout returned" : "Adjustment"}
                </p>
                <p className="text-muted">
                  {formatIstDate(l.created_at)}
                  {l.kind === "booking" && ` · total ${formatPaise(l.gross_paise)} · margin ${formatPaise(l.margin_paise)} · you collected ${formatPaise(l.cash_paise)} in cash`}
                  {l.kind === "adjustment" && l.note ? ` · ${l.note}` : ""}
                </p>
              </div>
              <span className={`flex-none font-semibold tabular-nums ${l.amount_paise < 0 ? "text-danger" : "text-success"}`}>
                {l.amount_paise < 0 ? "−" : "+"}
                {formatPaise(Math.abs(l.amount_paise))}
              </span>
            </li>
          ))}
          {!ledger.length && <li className="p-4 text-sm text-muted">Earnings appear here when you complete bookings.</li>}
        </ul>
      </section>
    </>
  );
}

export default function PayoutsPage() {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <Payouts />
    </Suspense>
  );
}
