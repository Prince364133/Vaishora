import "server-only";
import { Queryable } from "./db";
import { getSettings } from "./settings";

// Artist earnings ledger. Money model (see docs/ARTIST_PLATFORM_PLAN.md, A3):
// the customer pays an advance online to VAISHORA and the balance in cash to the artist. When a
// booking is completed, the artist is credited `advance collected − platform margin on the total`.
// If the margin exceeds the advance, the entry is negative (the artist owes the platform).

export class LedgerError extends Error {}

export interface EarningBreakdown {
  gross_paise: number;
  advance_paise: number;
  cash_paise: number;
  margin_bp: number;
  margin_paise: number;
  net_paise: number; // artist's total take-home (cash + payout share)
  payable_paise: number; // what the platform owes the artist for this booking
}

export function earningFor(total: number, advanceCollected: number, marginBp: number): EarningBreakdown {
  const margin = Math.round((total * marginBp) / 10_000);
  const advance = Math.max(0, Math.min(advanceCollected, total));
  return {
    gross_paise: total,
    advance_paise: advance,
    cash_paise: total - advance,
    margin_bp: marginBp,
    margin_paise: margin,
    net_paise: total - margin,
    payable_paise: advance - margin,
  };
}

/** Effective margin for an artist: their override, else the central platform margin. */
export async function marginFor(q: Queryable, artistId: string): Promise<number> {
  const [a, s] = await Promise.all([q.query<{ margin_bp: number | null }>(`SELECT margin_bp FROM artists WHERE id = $1`, [artistId]), getSettings(q)]);
  return a[0]?.margin_bp ?? s.platform_margin_bp;
}

/** Credits the artist for a completed booking. Idempotent (one entry per booking). */
export async function recordBookingEarning(q: Queryable, bookingId: string) {
  const b = (
    await q.query<{ artist_id: string | null; total_paise: number; paid: number }>(
      `SELECT b.artist_id, b.total_paise,
              (COALESCE((SELECT sum(p.amount_paise) FROM payments p WHERE p.booking_id = b.id AND p.status IN ('captured','refunded','partially_refunded')), 0)
               - COALESCE((SELECT sum(r.amount_paise) FROM refunds r WHERE r.booking_id = b.id AND r.status <> 'failed'), 0))::int AS paid
       FROM bookings b WHERE b.id = $1`,
      [bookingId],
    )
  )[0];
  if (!b?.artist_id) return;
  const e = earningFor(b.total_paise, b.paid, await marginFor(q, b.artist_id));
  await q.query(
    `INSERT INTO artist_ledger(artist_id, kind, amount_paise, booking_id, gross_paise, margin_paise, advance_paise, cash_paise, margin_bp, note)
     VALUES ($1, 'booking', $2, $3, $4, $5, $6, $7, $8, 'Booking completed')
     ON CONFLICT (booking_id) WHERE kind = 'booking' DO NOTHING`,
    [b.artist_id, e.payable_paise, bookingId, e.gross_paise, e.margin_paise, e.advance_paise, e.cash_paise, e.margin_bp],
  );
}

export interface ArtistBalance {
  available_paise: number; // can be requested now (pending requests already reserved)
  pending_payout_paise: number;
  paid_out_paise: number;
  lifetime_net_paise: number; // gross − margin over completed bookings
  lifetime_gross_paise: number;
  lifetime_margin_paise: number;
  cash_collected_paise: number;
}

export async function artistBalance(q: Queryable, artistId: string): Promise<ArtistBalance> {
  const r = (
    await q.query<ArtistBalance>(
      `SELECT COALESCE(sum(amount_paise), 0)::int AS available_paise,
              COALESCE(sum(gross_paise - margin_paise) FILTER (WHERE kind = 'booking'), 0)::int AS lifetime_net_paise,
              COALESCE(sum(gross_paise) FILTER (WHERE kind = 'booking'), 0)::int AS lifetime_gross_paise,
              COALESCE(sum(margin_paise) FILTER (WHERE kind = 'booking'), 0)::int AS lifetime_margin_paise,
              COALESCE(sum(cash_paise) FILTER (WHERE kind = 'booking'), 0)::int AS cash_collected_paise,
              COALESCE((SELECT sum(amount_paise) FROM payout_requests WHERE artist_id = $1 AND status IN ('requested','approved')), 0)::int AS pending_payout_paise,
              COALESCE((SELECT sum(amount_paise) FROM payout_requests WHERE artist_id = $1 AND status = 'paid'), 0)::int AS paid_out_paise
       FROM artist_ledger WHERE artist_id = $1`,
      [artistId],
    )
  )[0];
  return r;
}

/** Creates a payout request and reserves its amount. Call inside a transaction. */
export async function requestPayout(q: Queryable, artistId: string, amount: number) {
  await q.query(`SELECT pg_advisory_xact_lock(hashtext('vaishora:payout:' || $1))`, [artistId]);
  const s = await getSettings(q);
  if (!Number.isInteger(amount) || amount <= 0) throw new LedgerError("Enter an amount to withdraw.");
  if (amount < s.payout_min_paise) throw new LedgerError(`The minimum payout is ₹${(s.payout_min_paise / 100).toLocaleString("en-IN")}.`);
  const open = await q.query(`SELECT 1 FROM payout_requests WHERE artist_id = $1 AND status IN ('requested','approved')`, [artistId]);
  if (open.length) throw new LedgerError("You already have a payout in progress. You can request another once it is paid.");
  const bank = (
    await q.query<{ holder_name: string; account_last4: string; ifsc: string; bank_name: string; upi_id: string | null }>(
      `SELECT holder_name, account_last4, ifsc, bank_name, upi_id FROM artist_bank_accounts WHERE artist_id = $1`,
      [artistId],
    )
  )[0];
  if (!bank) throw new LedgerError("Add your bank account before requesting a payout.");
  const bal = await artistBalance(q, artistId);
  if (amount > bal.available_paise) throw new LedgerError("That is more than your available balance.");
  const r = await q.query<{ id: string }>(`INSERT INTO payout_requests(artist_id, amount_paise, bank_snapshot) VALUES ($1, $2, $3::jsonb) RETURNING id`, [
    artistId,
    amount,
    JSON.stringify(bank),
  ]);
  await q.query(`INSERT INTO artist_ledger(artist_id, kind, amount_paise, payout_id, note) VALUES ($1, 'payout', $2, $3, 'Payout requested')`, [artistId, -amount, r[0].id]);
  return r[0].id;
}

/** Admin decision on a payout. Rejection returns the reserved amount to the balance. */
export async function processPayout(q: Queryable, payoutId: string, action: "approve" | "paid" | "reject", by: string, opts: { reference?: string; note?: string } = {}) {
  const p = (await q.query<{ artist_id: string; amount_paise: number; status: string }>(`SELECT artist_id, amount_paise, status FROM payout_requests WHERE id = $1 FOR UPDATE`, [payoutId]))[0];
  if (!p) throw new LedgerError("Payout not found.");
  const allowed: Record<string, string[]> = { approve: ["requested"], paid: ["requested", "approved"], reject: ["requested", "approved"] };
  if (!allowed[action].includes(p.status)) throw new LedgerError(`This payout is already ${p.status}.`);
  if (action === "paid" && !opts.reference?.trim()) throw new LedgerError("Enter the bank reference (UTR) of the transfer.");
  const status = action === "approve" ? "approved" : action === "paid" ? "paid" : "rejected";
  await q.query(
    `UPDATE payout_requests SET status = $2, reference = COALESCE($3, reference), admin_note = COALESCE($4, admin_note),
       processed_at = CASE WHEN $2 IN ('paid','rejected') THEN now() ELSE processed_at END, processed_by = $5 WHERE id = $1`,
    [payoutId, status, opts.reference?.trim() || null, opts.note?.trim() || null, by],
  );
  if (action === "reject") {
    await q.query(
      `INSERT INTO artist_ledger(artist_id, kind, amount_paise, payout_id, note, created_by) VALUES ($1, 'payout_reversal', $2, $3, $4, $5)
       ON CONFLICT (payout_id, kind) WHERE payout_id IS NOT NULL DO NOTHING`,
      [p.artist_id, p.amount_paise, payoutId, opts.note?.trim() || "Payout rejected", by],
    );
  }
  return { ...p, status };
}
