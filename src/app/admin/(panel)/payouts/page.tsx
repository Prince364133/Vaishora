import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { getSettings } from "@/server/settings";
import { decryptField } from "@/server/vault";
import { ActionForm } from "@/components/admin/ActionForm";
import { processPayoutAction, saveMarginSettingsAction } from "../../actions";
import { formatPaise } from "@/lib/money";
import { formatIstDate } from "@/lib/time";
import { percentFromBp, timeAgo } from "@/lib/format";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";

export const metadata = { title: "Payouts & margins" };

function revealAccount(enc: string | null) {
  if (!enc) return null;
  try {
    return decryptField(enc);
  } catch {
    return null; // e.g. APP_SECRET rotated — the last 4 digits are still shown
  }
}

async function Content() {
  await connection();
  await requireRole(["admin"]);
  const db = await getDb();
  const settings = await getSettings(db);
  const [totals, open, history, balances] = await Promise.all([
    db.query<{ margin_all: number; margin_month: number; gross_month: number; owed: number; paid_month: number }>(
      `WITH m AS (SELECT (date_trunc('month', (now() AT TIME ZONE 'UTC') + interval '330 minutes') - interval '330 minutes') AT TIME ZONE 'UTC' AS start)
       SELECT COALESCE((SELECT sum(margin_paise) FROM artist_ledger WHERE kind = 'booking'), 0)::int AS margin_all,
              COALESCE((SELECT sum(l.margin_paise) FROM artist_ledger l, m WHERE l.kind = 'booking' AND l.created_at >= m.start), 0)::int AS margin_month,
              COALESCE((SELECT sum(l.gross_paise) FROM artist_ledger l, m WHERE l.kind = 'booking' AND l.created_at >= m.start), 0)::int AS gross_month,
              COALESCE((SELECT sum(GREATEST(b, 0)) FROM (SELECT sum(amount_paise) AS b FROM artist_ledger GROUP BY artist_id) x), 0)::int AS owed,
              COALESCE((SELECT sum(p.amount_paise) FROM payout_requests p, m WHERE p.status = 'paid' AND p.processed_at >= m.start), 0)::int AS paid_month`,
    ),
    db.query<{
      id: string; artist_id: string; artist_name: string; amount_paise: number; status: "requested" | "approved"; requested_at: string;
      holder_name: string | null; account_enc: string | null; account_last4: string | null; ifsc: string | null; bank_name: string | null; upi_id: string | null;
      bank_updated_at: string | null; bank_verified_at: string | null; bank_changed_recently: boolean;
    }>(
      `SELECT p.id, p.artist_id, a.name AS artist_name, p.amount_paise, p.status, p.requested_at,
              b.holder_name, b.account_enc, b.account_last4, b.ifsc, b.bank_name, b.upi_id, b.updated_at AS bank_updated_at, b.verified_at AS bank_verified_at,
              COALESCE(b.updated_at > now() - interval '3 days', false) AS bank_changed_recently
       FROM payout_requests p JOIN artists a ON a.id = p.artist_id LEFT JOIN artist_bank_accounts b ON b.artist_id = p.artist_id
       WHERE p.status IN ('requested','approved') ORDER BY p.requested_at`,
    ),
    db.query<{ id: string; artist_name: string; amount_paise: number; status: string; reference: string | null; admin_note: string | null; processed_at: string | null }>(
      `SELECT p.id, a.name AS artist_name, p.amount_paise, p.status, p.reference, p.admin_note, p.processed_at
       FROM payout_requests p JOIN artists a ON a.id = p.artist_id WHERE p.status IN ('paid','rejected') ORDER BY p.processed_at DESC LIMIT 30`,
    ),
    db.query<{ id: string; name: string; status: string; balance: number; earned: number; margin: number; margin_bp: number | null }>(
      `SELECT a.id, a.name, a.status, COALESCE(sum(l.amount_paise), 0)::int AS balance,
              COALESCE(sum(l.gross_paise - l.margin_paise) FILTER (WHERE l.kind = 'booking'), 0)::int AS earned,
              COALESCE(sum(l.margin_paise) FILTER (WHERE l.kind = 'booking'), 0)::int AS margin, a.margin_bp
       FROM artists a LEFT JOIN artist_ledger l ON l.artist_id = a.id
       WHERE a.status IN ('active','suspended') AND NOT a.is_demo
       GROUP BY a.id ORDER BY balance DESC, a.name LIMIT 200`,
    ),
  ]);
  const t = totals[0];
  const tiles: [string, string, string][] = [
    ["Platform margin this month", formatPaise(t.margin_month), `on ${formatPaise(t.gross_month)} of completed bookings`],
    ["Platform margin all time", formatPaise(t.margin_all), "from completed bookings"],
    ["Owed to artists", formatPaise(t.owed), "positive balances, not yet requested"],
    ["Paid out this month", formatPaise(t.paid_month), `${open.length} request${open.length === 1 ? "" : "s"} waiting`],
  ];
  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([l, v, h]) => (
          <div key={l} className="card p-4">
            <p className="text-xs text-muted">{l}</p>
            <p className="mt-1 text-[1.35rem] font-semibold text-plum tabular-nums sm:text-2xl">{v}</p>
            <p className="text-xs text-muted">{h}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="text-2xl">Platform margin</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Taken from each booking total when the artist completes it. The customer’s advance (paid online) is credited to the artist minus this margin. Per-artist overrides are set on the artist’s page.
        </p>
        <ActionForm action={saveMarginSettingsAction} submitLabel="Save" resetOnSuccess={false} className="card mt-3 max-w-xl p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field">
              <span className="label">Central margin (%)</span>
              <input name="margin_percent" type="number" step="0.01" min={0} max={60} required defaultValue={settings.platform_margin_bp / 100} className="input" />
            </label>
            <label className="field">
              <span className="label">Minimum payout (₹)</span>
              <input name="payout_min" type="number" step="1" min={1} required defaultValue={settings.payout_min_paise / 100} className="input" />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted">Current advance: {settings.advance_percent}% of the booking total. Keep the margin at or below the advance so artists are not left owing.</p>
        </ActionForm>
      </section>

      <section>
        <h2 className="text-2xl">Payout requests</h2>
        <ul className="mt-3 space-y-3">
          {open.map((p) => {
            const acct = revealAccount(p.account_enc);
            const changedRecently = p.bank_changed_recently;
            return (
              <li key={p.id} className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link href={`/admin/artists/${p.artist_id}`} className="link font-semibold">{p.artist_name}</Link>
                    <p className="text-xs text-muted">Requested {timeAgo(p.requested_at)} · {p.status === "approved" ? "approved" : "awaiting approval"}</p>
                  </div>
                  <p className="text-2xl font-semibold text-plum tabular-nums">{formatPaise(p.amount_paise)}</p>
                </div>
                {p.holder_name ? (
                  <div className="mt-3 rounded-[var(--radius-sm)] bg-blush/60 p-3 text-sm">
                    <p><span className="text-muted">Holder:</span> {p.holder_name}</p>
                    <p><span className="text-muted">Account:</span> <span className="font-mono tracking-wide select-all">{acct ?? `•••• ${p.account_last4}`}</span></p>
                    <p><span className="text-muted">IFSC:</span> <span className="font-mono select-all">{p.ifsc}</span>{p.bank_name ? ` · ${p.bank_name}` : ""}</p>
                    {p.upi_id && <p><span className="text-muted">UPI:</span> <span className="select-all">{p.upi_id}</span></p>}
                    <p className="mt-1 text-xs">
                      {p.bank_verified_at ? <span className="text-success">Bank verified</span> : <span className="text-danger">Bank not verified</span>}
                      {changedRecently && <span className="ml-2 font-semibold text-danger">⚠ Bank details changed {timeAgo(p.bank_updated_at!)} — confirm with the artist before paying</span>}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-danger">No bank account on file.</p>
                )}
                <div className="mt-2 flex flex-wrap items-start gap-x-4">
                  {p.status === "requested" && (
                    <ActionForm action={processPayoutAction} submitLabel="Approve">
                      <input type="hidden" name="payoutId" value={p.id} />
                      <input type="hidden" name="action" value="approve" />
                    </ActionForm>
                  )}
                  <ActionForm action={processPayoutAction} submitLabel="Mark paid" className="flex flex-wrap items-end gap-2 [&>div]:mt-0">
                    <input type="hidden" name="payoutId" value={p.id} />
                    <input type="hidden" name="action" value="paid" />
                    <input name="reference" required maxLength={80} placeholder="Bank UTR / reference" aria-label="Bank reference" className="input mt-4 min-h-10 max-w-56 py-1.5" />
                  </ActionForm>
                </div>
                <details className="mt-2">
                  <summary className="link tap-link cursor-pointer text-sm">Reject</summary>
                  <ActionForm action={processPayoutAction} submitLabel="Reject and return to balance" danger className="mt-2">
                    <input type="hidden" name="payoutId" value={p.id} />
                    <input type="hidden" name="action" value="reject" />
                    <input name="note" required minLength={5} maxLength={300} placeholder="Reason (emailed to the artist)" aria-label="Rejection reason" className="input" />
                  </ActionForm>
                </details>
              </li>
            );
          })}
          {!open.length && <li className="card p-6 text-center text-muted">No payout requests waiting.</li>}
        </ul>
      </section>

      <section>
        <h2 className="text-2xl">Artist balances</h2>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b hairline">
                <th className="p-3">Artist</th>
                <th className="p-3 text-right">Balance</th>
                <th className="p-3 text-right">Earned (net)</th>
                <th className="p-3 text-right">Platform margin</th>
                <th className="p-3 text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.id} className="border-b hairline last:border-0">
                  <td className="p-3">
                    <Link className="link font-semibold" href={`/admin/artists/${b.id}`}>{b.name}</Link>
                    {b.status !== "active" && <span className="ml-2 text-xs text-danger">{b.status}</span>}
                  </td>
                  <td className={`p-3 text-right tabular-nums ${b.balance < 0 ? "text-danger" : ""}`}>{formatPaise(b.balance)}</td>
                  <td className="p-3 text-right tabular-nums">{formatPaise(b.earned)}</td>
                  <td className="p-3 text-right tabular-nums">{formatPaise(b.margin)}</td>
                  <td className="p-3 text-right">{percentFromBp(b.margin_bp ?? settings.platform_margin_bp)}{b.margin_bp != null && <span className="text-xs text-muted"> (custom)</span>}</td>
                </tr>
              ))}
              {!balances.length && (
                <tr><td colSpan={5} className="p-6 text-center text-muted">No active artists yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-2xl">Recent payouts</h2>
        <ul className="mt-3 divide-y hairline card">
          {history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span>
                <strong>{h.artist_name}</strong> · {h.processed_at ? formatIstDate(h.processed_at) : ""} · {h.status === "paid" ? `Ref ${h.reference}` : `Rejected: ${h.admin_note ?? ""}`}
              </span>
              <span className={`font-semibold tabular-nums ${h.status === "paid" ? "text-success" : "text-muted line-through"}`}>{formatPaise(h.amount_paise)}</span>
            </li>
          ))}
          {!history.length && <li className="p-4 text-sm text-muted">No payouts yet.</li>}
        </ul>
      </section>
    </div>
  );
}

export default function PayoutsAdminPage() {
  return (
    <>
      <h1 className="text-[2.25rem] sm:text-4xl">Payouts & margins</h1>
      <div className="mt-5">
        <Suspense fallback={<AdaptiveSkeleton />}>
          <Content />
        </Suspense>
      </div>
    </>
  );
}
