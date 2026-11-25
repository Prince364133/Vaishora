import "server-only";
import crypto from "node:crypto";
import { getDb, Queryable } from "./db";
import { getSettings, BusinessSettings } from "./settings";
import { getDesignBySlug, listPricingRules } from "./catalog";
import { computeDaySlots, expireStaleHolds } from "./availability";
import { bookingCode, sha256 } from "./crypto";
import { appSecret } from "./env";
import { computeQuote, Quote, QuoteCoupon, QuoteError, QuoteOptions } from "@/lib/pricing";
import { assertTransition, BookingStatus } from "@/lib/booking-status";
import type { BookingRequest } from "@/lib/schemas";
import { istToUtc } from "@/lib/time";
import { recordBookingEarning } from "./ledger";
import { queueEmail } from "./email";
import { addressLine, createAddress, getAddress } from "./customer-addresses";
import { formatIstDate, formatIstTime } from "@/lib/time";

export class BookingError extends Error {
  constructor(message: string, public code: "slot_taken" | "invalid" | "not_found" | "unavailable" = "invalid", public status = 400) {
    super(message);
  }
}

/** The customer's private link token is derived from the booking id, never stored in clear. */
export function bookingAccessToken(bookingId: string) {
  return crypto.createHmac("sha256", appSecret()).update(`booking:${bookingId}`).digest("base64url");
}

export async function findCoupon(q: Queryable, code: string | undefined): Promise<QuoteCoupon | null> {
  if (!code) return null;
  const rows = await q.query<QuoteCoupon>(
    `SELECT id, code, kind, value, min_order_paise, max_discount_paise FROM coupons
     WHERE code = $1 AND active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
       AND (usage_limit IS NULL OR used_count < usage_limit)`,
    [code.toUpperCase()],
  );
  return rows[0] ?? null;
}

export async function quoteForDesign(q: Queryable, slug: string, options: QuoteOptions, couponCode?: string) {
  const design = await getDesignBySlug(slug, q);
  if (!design || design.status === "draft" || design.review_status !== "approved") throw new BookingError("This design is not available.", "not_found", 404);
  if (design.artist_id) {
    const owner = await q.query(`SELECT 1 FROM artists WHERE id = $1 AND status = 'active'`, [design.artist_id]);
    if (!owner.length) throw new BookingError("This artist is not taking bookings right now.", "unavailable", 409);
    if (design.status !== "active") throw new BookingError("This design is not available for booking right now.", "unavailable", 409);
  }
  if (design.status === "unavailable") throw new BookingError("This design is temporarily unavailable for booking.", "unavailable", 409);
  const [rules, settings, coupon] = await Promise.all([listPricingRules({}, q), getSettings(q), findCoupon(q, couponCode)]);
  try {
    const quote = computeQuote(design, rules, settings, options, coupon, couponCode);
    return { design, quote, settings, coupon: quote.coupon?.applied ? coupon : null };
  } catch (e) {
    if (e instanceof QuoteError) throw new BookingError(e.message);
    throw e;
  }
}

export async function recordStatus(
  q: Queryable,
  bookingId: string,
  from: BookingStatus | null,
  to: BookingStatus,
  actor: { type: "system" | "customer" | "admin" | "artist" | "webhook"; id?: string | null },
  note = "",
) {
  await q.query(
    `INSERT INTO booking_status_history(booking_id, from_status, to_status, actor_type, actor_id, note) VALUES ($1, $2, $3, $4, $5, $6)`,
    [bookingId, from, to, actor.type, actor.id ?? null, note],
  );
}

/** Move a booking to a new status inside a transaction, enforcing the state machine. */
export async function transitionBooking(
  q: Queryable,
  bookingId: string,
  to: BookingStatus,
  actor: { type: "system" | "customer" | "admin" | "artist" | "webhook"; id?: string | null },
  note = "",
  patch: { artist_id?: string | null } = {},
) {
  const rows = await q.query<{ status: BookingStatus }>(`SELECT status FROM bookings WHERE id = $1 FOR UPDATE`, [bookingId]);
  if (!rows[0]) throw new BookingError("Booking not found", "not_found", 404);
  const from = rows[0].status;
  if (from === to && patch.artist_id === undefined) return from;
  if (from !== to) assertTransition(from, to);
  const sets = ["status = $2", "updated_at = now()"];
  const params: unknown[] = [bookingId, to];
  if (patch.artist_id !== undefined) {
    params.push(patch.artist_id);
    sets.push(`artist_id = $${params.length}`);
  }
  if (to !== "pending_payment") sets.push("hold_expires_at = NULL");
  await q.query(`UPDATE bookings SET ${sets.join(", ")} WHERE id = $1`, params);
  await recordStatus(q, bookingId, from, to, actor, note);
  // Same transaction: a completed booking always credits the artist exactly once.
  if (to === "completed") await recordBookingEarning(q, bookingId);
  if (to === "awaiting_artist_confirmation") await notifyArtistOfRequest(q, bookingId);
  return from;
}

/** Emails the assigned artist about a new booking request (sent after the response). */
async function notifyArtistOfRequest(q: Queryable, bookingId: string) {
  const r = (
    await q.query<{ email: string | null; artist_id: string; name: string; code: string; starts_at: string; design: string; locality: string }>(
      `SELECT a.email, a.id AS artist_id, a.name, b.code, b.starts_at, d.name AS design, l.name AS locality
       FROM bookings b JOIN artists a ON a.id = b.artist_id JOIN designs d ON d.id = b.design_id JOIN localities l ON l.id = b.locality_id
       WHERE b.id = $1`,
      [bookingId],
    )
  )[0];
  if (!r?.email) return;
  queueEmail({
    to: r.email,
    template: "artist_booking_request",
    artistId: r.artist_id,
    bookingId,
    subject: `New booking request ${r.code} — ${formatIstDate(r.starts_at)}`,
    heading: "You have a new booking request",
    paragraphs: [
      `${r.design} in ${r.locality} on ${formatIstDate(r.starts_at)} at ${formatIstTime(r.starts_at)} (IST). The customer has paid the advance.`,
      "Please accept or decline it from your artist portal as soon as possible.",
    ],
    cta: { label: "Respond now", path: "/artist-portal/orders" },
  });
}

export interface CreatedBooking {
  id: string;
  code: string;
  token: string;
  status: BookingStatus;
  advance_paise: number;
  total_paise: number;
  hold_expires_at: string;
}

function isExclusionViolation(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23P01";
}

export async function createBooking(input: BookingRequest, idempotencyKey: string | null, customerId: string): Promise<CreatedBooking> {
  const db = await getDb();
  let req = input;
  try {
    return await db.tx(async (q) => {
      // Serialise booking creation so availability checks and inserts cannot interleave.
      await q.query(`SELECT pg_advisory_xact_lock(hashtext('vaishora:booking'))`);

      if (idempotencyKey) {
        const existing = await q.query<CreatedBooking & { hold_expires_at: string }>(
          `SELECT id, code, status, advance_paise, total_paise, hold_expires_at FROM bookings WHERE idempotency_key = $1`,
          [idempotencyKey],
        );
        if (existing[0]) return { ...existing[0], token: bookingAccessToken(existing[0].id) };
      }

      await expireStaleHolds(q);
      const { design, quote, settings, coupon } = await quoteForDesign(q, req.designSlug, req.options, req.couponCode);
      if (req.couponCode && !quote.coupon?.applied) throw new BookingError(quote.coupon?.message ?? "Coupon is not valid.");

      // The address: a saved one (verified to belong to this customer), or a new one picked on the map.
      if (req.address.id) {
        const saved = await getAddress(q, customerId, req.address.id);
        if (!saved) throw new BookingError("That saved address was not found. Please choose another.");
        req = {
          ...req,
          address: { ...req.address, line: addressLine(saved), localityId: saved.locality_id, landmark: saved.landmark, instructions: req.address.instructions || saved.instructions, placeId: saved.place_id ?? undefined, lat: saved.lat, lng: saved.lng },
        };
      }
      const loc = await q.query<{ id: number; city: string }>(`SELECT id, city FROM localities WHERE id = $1 AND active`, [req.address.localityId]);
      if (!loc[0]) throw new BookingError("We do not serve this locality yet.");

      const day = await computeDaySlots(
        q,
        {
          date: req.date,
          durationMinutes: quote.duration_minutes,
          localityId: req.address.localityId,
          categorySlug: design.category_slug,
          eligibility: design.artist_eligibility,
          artistId: design.artist_id,
        },
        settings,
      );
      const free = day.free.get(req.startMinute);
      if (!free?.length) throw new BookingError("Sorry — that time was just taken. Please choose another slot.", "slot_taken", 409);

      // Prefer the artist with the lightest schedule that day.
      const load = await q.query<{ artist_id: string; n: number }>(
        `SELECT artist_id, count(*)::int AS n FROM bookings WHERE artist_id = ANY($1::uuid[]) AND ((starts_at AT TIME ZONE 'UTC') + interval '330 minutes')::date = $2::date
         AND status NOT IN ('cancelled', 'expired', 'refunded') GROUP BY artist_id`,
        [free, req.date],
      );
      const n = new Map(load.map((r) => [r.artist_id, r.n]));
      const artistId = [...free].sort((a, b) => (n.get(a) ?? 0) - (n.get(b) ?? 0))[0];

      const customer = await q.query<{ id: string }>(
        `SELECT id FROM customers WHERE id = $1 AND profile_completed_at IS NOT NULL AND phone IS NOT NULL`,
        [customerId],
      );
      if (!customer[0]) throw new BookingError("Please complete your details before booking.", "invalid", 409);
      let addressId = req.address.id ?? null;
      const a = req.address;
      if (!addressId && a.save && a.lat != null && a.lng != null && a.house && a.formatted) {
        // Saving to the address book is a convenience: it must never block the booking (e.g. a full book).
        // A savepoint keeps any database error here from aborting the booking transaction.
        await q.query("SAVEPOINT save_address");
        try {
          addressId = (
            await createAddress(q, customerId, {
              label: a.label || "Home",
              house: a.house,
              building: a.building ?? "",
              formatted_address: a.formatted,
              place_id: a.placeId ?? null,
              lat: a.lat,
              lng: a.lng,
              locality_id: a.localityId,
              landmark: a.landmark,
              instructions: a.instructions,
            })
          ).id;
          await q.query("RELEASE SAVEPOINT save_address");
        } catch (e) {
          await q.query("ROLLBACK TO SAVEPOINT save_address");
          console.warn("[booking] address not saved:", (e as Error).message);
        }
      }

      const starts = istToUtc(req.date, req.startMinute);
      const ends = new Date(starts.getTime() + quote.duration_minutes * 60_000);
      const bufferMs = settings.buffer_minutes * 60_000;
      const holdUntil = new Date(Date.now() + settings.hold_minutes * 60_000);

      const id = crypto.randomUUID();
      const token = bookingAccessToken(id);
      let code = bookingCode();
      for (let i = 0; i < 3; i++) {
        const clash = await q.query(`SELECT 1 FROM bookings WHERE code = $1`, [code]);
        if (!clash.length) break;
        code = bookingCode();
      }

      await q.query(
        `INSERT INTO bookings(id, code, access_token_hash, idempotency_key, customer_id, design_id, artist_id, status,
            starts_at, ends_at, block, duration_minutes, people_count, options, address_line, locality_id, city, landmark,
            instructions, special_requirements, subtotal_paise, discount_paise, fee_paise, tax_paise, total_paise,
            advance_paise, coupon_id, hold_expires_at, address_id, lat, lng, place_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_payment',$8,$9,tstzrange($10,$11),$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)`,
        [
          id, code, sha256(token), idempotencyKey, customer[0].id, design.id, artistId,
          starts.toISOString(), ends.toISOString(),
          new Date(starts.getTime() - bufferMs).toISOString(), new Date(ends.getTime() + bufferMs).toISOString(),
          quote.duration_minutes, quote.options.people, JSON.stringify(quote.options), req.address.line, req.address.localityId,
          loc[0].city, req.address.landmark, req.address.instructions, req.specialRequirements,
          quote.subtotal_paise, quote.discount_paise, quote.fee_paise, quote.tax_paise, quote.total_paise, quote.advance_paise,
          coupon?.id ?? null, holdUntil.toISOString(),
          addressId, req.address.lat ?? null, req.address.lng ?? null, req.address.placeId ?? null,
        ],
      );
      await insertItems(q, id, quote);
      await recordStatus(q, id, null, "pending_payment", { type: "customer" }, "Booking created, awaiting advance payment");
      return {
        id,
        code,
        token,
        status: "pending_payment" as const,
        advance_paise: quote.advance_paise,
        total_paise: quote.total_paise,
        hold_expires_at: holdUntil.toISOString(),
      };
    });
  } catch (e) {
    if (isExclusionViolation(e)) throw new BookingError("Sorry — that time was just taken. Please choose another slot.", "slot_taken", 409);
    throw e;
  }
}

async function insertItems(q: Queryable, bookingId: string, quote: Quote) {
  let sort = 0;
  for (const l of quote.lines) {
    await q.query(
      `INSERT INTO booking_items(booking_id, kind, code, label, quantity, amount_paise, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [bookingId, l.kind, l.code, l.label, l.quantity, l.amount_paise, sort++],
    );
  }
}

export interface BookingView {
  id: string;
  code: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  people_count: number;
  options: Record<string, unknown>;
  address_line: string;
  locality: string;
  city: string;
  landmark: string;
  instructions: string;
  special_requirements: string;
  subtotal_paise: number;
  discount_paise: number;
  fee_paise: number;
  tax_paise: number;
  total_paise: number;
  advance_paise: number;
  hold_expires_at: string | null;
  created_at: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  design_slug: string;
  design_name: string;
  design_region: string;
  design_assets: Record<string, string>;
  artist_id: string | null;
  artist_name: string | null;
  artist_phone: string | null;
  paid_paise: number;
  refunded_paise: number;
  items: { kind: string; label: string; amount_paise: number }[];
  has_review: boolean;
}

const VIEW_SELECT = `
  SELECT b.id, b.code, b.status, b.starts_at, b.ends_at, b.duration_minutes, b.people_count, b.options, b.address_line,
         l.name AS locality, b.city, b.landmark, b.instructions, b.special_requirements, b.subtotal_paise, b.discount_paise,
         b.fee_paise, b.tax_paise, b.total_paise, b.advance_paise, b.hold_expires_at, b.created_at,
         c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
         d.slug AS design_slug, d.name AS design_name, d.region AS design_region,
         COALESCE((SELECT jsonb_object_agg(a.kind, a.url) FROM design_assets a WHERE a.design_id = d.id), '{}'::jsonb) AS design_assets,
         b.artist_id, ar.name AS artist_name, ar.phone AS artist_phone,
         COALESCE((SELECT sum(p.amount_paise) FROM payments p WHERE p.booking_id = b.id AND p.status IN ('captured', 'refunded', 'partially_refunded')), 0)::int AS paid_paise,
         COALESCE((SELECT sum(r.amount_paise) FROM refunds r WHERE r.booking_id = b.id AND r.status <> 'failed'), 0)::int AS refunded_paise,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', i.kind, 'label', i.label, 'amount_paise', i.amount_paise) ORDER BY i.sort) FROM booking_items i WHERE i.booking_id = b.id), '[]'::jsonb) AS items,
         EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id) AS has_review
  FROM bookings b
  JOIN customers c ON c.id = b.customer_id
  JOIN designs d ON d.id = b.design_id
  JOIN localities l ON l.id = b.locality_id
  LEFT JOIN artists ar ON ar.id = b.artist_id`;

export async function getBookingByToken(token: string, q?: Queryable): Promise<BookingView | null> {
  const db = q ?? (await getDb());
  if (!token || token.length < 20) return null;
  const rows = await db.query<BookingView>(`${VIEW_SELECT} WHERE b.access_token_hash = $1`, [sha256(token)]);
  return rows[0] ?? null;
}

export async function getBookingById(id: string, q?: Queryable): Promise<BookingView | null> {
  const db = q ?? (await getDb());
  const rows = await db.query<BookingView>(`${VIEW_SELECT} WHERE b.id = $1`, [id]);
  return rows[0] ?? null;
}

/** Refund amount a customer is entitled to if they cancel now, per the configured policy. */
export function refundEntitlement(b: Pick<BookingView, "starts_at" | "paid_paise" | "refunded_paise">, s: BusinessSettings, now = new Date()) {
  const hours = (new Date(b.starts_at).getTime() - now.getTime()) / 3600_000;
  const refundable = b.paid_paise - b.refunded_paise;
  if (refundable <= 0) return { amount: 0, percent: 0, hours };
  if (hours >= s.cancellation.full_refund_hours) return { amount: refundable, percent: 100, hours };
  if (hours >= s.cancellation.partial_refund_hours) {
    const pct = s.cancellation.partial_refund_percent;
    return { amount: Math.floor((refundable * pct) / 100 / 100) * 100, percent: pct, hours };
  }
  return { amount: 0, percent: 0, hours };
}
