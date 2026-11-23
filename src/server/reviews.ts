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
