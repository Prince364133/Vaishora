import "server-only";
import { getDb, Queryable } from "./db";

export interface PublicReview {
  id: string;
  rating: number;
  body: string;
  name: string;
  context: string;
  source: string;
  source_url: string | null;
  date: string;
}

/** Published reviews only. Names are shortened to first name + initial for privacy. */
export async function listPublishedReviews(limit = 9, q?: Queryable): Promise<PublicReview[]> {
  const db = q ?? (await getDb());
  return db.query<PublicReview>(
    `SELECT r.id, r.rating, r.body,
            CASE WHEN r.source = 'booking' THEN split_part(c.name, ' ', 1) ELSE r.reviewer_name END AS name,
            CASE WHEN r.source = 'booking' THEN d.name || ' · ' || l.name ELSE initcap(r.source) END AS context,
            r.source, r.source_url,
            to_char(COALESCE(r.reviewed_on, r.created_at::date), 'Mon YYYY') AS date
     FROM reviews r
     LEFT JOIN customers c ON c.id = r.customer_id
     LEFT JOIN bookings b ON b.id = r.booking_id
     LEFT JOIN designs d ON d.id = b.design_id
     LEFT JOIN localities l ON l.id = b.locality_id
     WHERE r.status = 'published' AND length(trim(r.body)) >= 10
     ORDER BY COALESCE(r.reviewed_on, r.created_at::date) DESC, r.created_at DESC
     LIMIT $1`,
    [limit],
  );
}

export async function reviewSummary(q?: Queryable): Promise<{ count: number; average: number | null }> {
  const db = q ?? (await getDb());
  const r = await db.query<{ count: number; average: number | null }>(
    `SELECT count(*)::int AS count, round(avg(rating)::numeric, 1)::float8 AS average FROM reviews WHERE status = 'published'`,
  );
  return r[0];
}

// ------------------------------------------------------------------ asking customers to rate their artist

/** The customer can rate the booking: the booked time is over and the session happened. */
export const REVIEW_ALLOWED_SQL = `b.ends_at < now() AND b.ends_at > now() - interval '120 days'
  AND b.status IN ('completed', 'confirmed', 'in_progress') AND b.artist_id IS NOT NULL`;

/** We should ask (email / in-app): allowed, within 30 days, not reviewed and not skipped. */
export const REVIEW_DUE_SQL = `${REVIEW_ALLOWED_SQL} AND b.ends_at > now() - interval '30 days'
  AND b.review_skipped_at IS NULL AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)`;

export interface DueReview {
  id: string;
  design: string;
  artist: string;
  starts_at: string;
  photo: string | null;
}

/** The customer's most recent booking that is ready to be rated (for the in-app prompt). */
export async function findDueReview(q: Queryable, customerId: string): Promise<DueReview | null> {
  return (
    (
      await q.query<DueReview>(
        `SELECT b.id, d.name AS design, a.name AS artist, b.starts_at,
                (SELECT p.url FROM design_photos p WHERE p.design_id = d.id ORDER BY p.sort LIMIT 1) AS photo
         FROM bookings b JOIN designs d ON d.id = b.design_id JOIN artists a ON a.id = b.artist_id
         WHERE b.customer_id = $1 AND ${REVIEW_DUE_SQL}
         ORDER BY b.ends_at DESC LIMIT 1`,
        [customerId],
      )
    )[0] ?? null
  );
}

export class ReviewError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

/** Saves a customer's rating (pending moderation). Idempotent per booking. */
export async function submitBookingReview(q: Queryable, bookingId: string, rating: number, body: string) {
  const ok = await q.query(`SELECT 1 FROM bookings b WHERE b.id = $1 AND ${REVIEW_ALLOWED_SQL}`, [bookingId]);
  if (!ok.length) throw new ReviewError("You can rate your artist once the booked time is over.");
  const rows = await q.query<{ id: string }>(
    `INSERT INTO reviews(booking_id, artist_id, customer_id, rating, body, source, status)
     SELECT b.id, b.artist_id, b.customer_id, $2, $3, 'booking', 'pending' FROM bookings b WHERE b.id = $1
     ON CONFLICT (booking_id) DO NOTHING RETURNING id`,
    [bookingId, rating, body],
  );
  if (!rows.length) throw new ReviewError("You have already rated this booking. Thank you!");
  return rows[0].id;
}

export async function skipBookingReview(q: Queryable, bookingId: string) {
  await q.query(`UPDATE bookings SET review_skipped_at = COALESCE(review_skipped_at, now()) WHERE id = $1`, [bookingId]);
}

/**
 * Emails "rate your artist" for every booking that became due, once each. Rows are claimed atomically
 * (review_requested_at) so parallel runs never send twice. Returns how many were sent.
 */
export async function sendDueReviewRequests(q: Queryable, limit = 50): Promise<number> {
  const due = await q.query<{ id: string; email: string; customer: string; artist: string; design: string; starts_at: string }>(
    `UPDATE bookings b SET review_requested_at = now()
     FROM customers c, artists a, designs d
     WHERE b.id IN (SELECT b.id FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE c.email IS NOT NULL AND b.review_requested_at IS NULL AND ${REVIEW_DUE_SQL} ORDER BY b.ends_at LIMIT $1)
       AND c.id = b.customer_id AND a.id = b.artist_id AND d.id = b.design_id
     RETURNING b.id, c.email, c.name AS customer, a.name AS artist, d.name AS design, b.starts_at`,
    [limit],
  );
  if (!due.length) return 0;
  const { sendEmail } = await import("./email");
  const { bookingAccessToken } = await import("./bookings");
  for (const r of due) {
    const first = r.artist.split(" ")[0];
    await sendEmail({
      to: r.email,
      template: "review_request",
      bookingId: r.id,
      subject: `How was your mehndi with ${first}?`,
      heading: `How was your mehndi${r.customer ? `, ${r.customer.split(" ")[0]}` : ""}?`,
      paragraphs: [
        `We hope you love your ${r.design}! Please take a few seconds to rate ${r.artist}.`,
        "Your rating helps other customers choose, and helps your artist grow. It takes one tap.",
      ],
      cta: { label: `Rate ${first}`, path: `/review/${bookingAccessToken(r.id)}` },
    });
  }
  return due.length;
}

const g = globalThis as unknown as { __vaishoraReviewSweep?: number };
/** Throttled background run (at most every 5 minutes per server) — piggybacks on normal site traffic. */
export async function maybeSendReviewRequests() {
  const now = Date.now();
  if (g.__vaishoraReviewSweep && now - g.__vaishoraReviewSweep < 5 * 60_000) return;
  g.__vaishoraReviewSweep = now;
  try {
    await sendDueReviewRequests(await getDb());
  } catch (e) {
    console.warn("[reviews] review request sweep failed", (e as Error).message);
  }
}

/** Where a booking stands for rating: can be rated now, already rated, or the booked time isn't over yet. */
export async function reviewState(q: Queryable, bookingId: string): Promise<"allowed" | "done" | "not_yet"> {
  const r = (
    await q.query<{ done: boolean; allowed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM reviews WHERE booking_id = b.id) AS done, (${REVIEW_ALLOWED_SQL}) AS allowed FROM bookings b WHERE b.id = $1`,
      [bookingId],
    )
  )[0];
  return r?.done ? "done" : r?.allowed ? "allowed" : "not_yet";
}
