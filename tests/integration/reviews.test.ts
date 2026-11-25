// "Rate your artist" after the booked time: due detection, skip, one email per booking, rating rules.
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import { findDueReview, ReviewError, reviewState, sendDueReviewRequests, skipBookingReview, submitBookingReview } from "@/server/reviews";

let customer = "";
let artist = "";
let design = "";
let locality = 0;
let n = 0;

/** A booking whose time window ended `endedHoursAgo` hours ago (negative = in the future). */
async function booking(status: string, endedHoursAgo: number) {
  const db = await getDb();
  n++;
  const r = await db.query<{ id: string }>(
    `INSERT INTO bookings(code, access_token_hash, customer_id, design_id, artist_id, status, starts_at, ends_at, block, duration_minutes,
       address_line, locality_id, city, subtotal_paise, total_paise, advance_paise)
     VALUES ($1, $2, $3, $4, $5, $6, now() - ($7::float8 * interval '1 hour') - interval '1 hour', now() - ($7::float8 * interval '1 hour'),
       tstzrange(now() - ($7::float8 * interval '1 hour') - interval '1 hour', now() - ($7::float8 * interval '1 hour')), 60, 'Flat 1, Test Road', $8, 'Hyderabad', 50000, 50000, 15000)
     RETURNING id`,
    [`VSH-RV${String(n).padStart(4, "0")}`, `rv-${n}-${Date.now()}`, customer, design, artist, status, endedHoursAgo, locality],
  );
  return r[0].id;
}

beforeAll(async () => {
  const db = await getDb();
  await db.query(`INSERT INTO design_categories(slug, name) VALUES ('rv-cat', 'RV') ON CONFLICT DO NOTHING`);
  design = (await db.query<{ id: string }>(`INSERT INTO designs(slug, name, category_slug, region, complexity, duration_minutes, base_price_paise, status) VALUES ('rv-design','RV Design','rv-cat','palm','simple',60,50000,'active') RETURNING id`))[0].id;
  locality = (await db.query<{ id: number }>(`INSERT INTO localities(name, zone) VALUES ('RV Locality','West') RETURNING id`))[0].id;
  artist = (await db.query<{ id: string }>(`INSERT INTO artists(slug, name, phone, status) VALUES ('rv-artist','Rani Verma','+919000044444','active') RETURNING id`))[0].id;
  customer = (await db.query<{ id: string }>(`INSERT INTO customers(name, phone, email, gender, profile_completed_at) VALUES ('Kavya','+919811155555','kavya@example.com','female',now()) RETURNING id`))[0].id;
});

describe("rate your artist", () => {
  it("is not due before the booked time is over", async () => {
    const db = await getDb();
    const future = await booking("confirmed", -5);
    expect(await reviewState(db, future)).toBe("not_yet");
    await expect(submitBookingReview(db, future, 5, "")).rejects.toBeInstanceOf(ReviewError);
  });

  it("is due once the time is over (even if the artist forgot to mark it completed), newest first", async () => {
    const db = await getDb();
    const older = await booking("completed", 30);
    const newer = await booking("confirmed", 2);
    expect(await reviewState(db, newer)).toBe("allowed");
    const due = await findDueReview(db, customer);
    expect(due?.id).toBe(newer);
    expect(due?.artist).toBe("Rani Verma");
    // skipping removes it from the prompt; the next one shows
    await skipBookingReview(db, newer);
    expect((await findDueReview(db, customer))?.id).toBe(older);
  });

  it("never asks about cancelled bookings", async () => {
    const db = await getDb();
    const c = await booking("cancelled", 3);
    expect(await reviewState(db, c)).toBe("not_yet");
  });

  it("sends each 'rate your artist' email once", async () => {
    const db = await getDb();
    const first = await sendDueReviewRequests(db);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(await sendDueReviewRequests(db)).toBe(0);
    const logged = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE template = 'review_request'`);
    expect(logged[0].n).toBe(first);
  });

  it("accepts one rating per booking (comment optional) and stops asking", async () => {
    const db = await getDb();
    const b = await booking("in_progress", 1);
    await submitBookingReview(db, b, 4, "");
    expect(await reviewState(db, b)).toBe("done");
    await expect(submitBookingReview(db, b, 5, "again")).rejects.toThrow(/already/);
    const r = (await db.query<{ status: string; rating: number; artist_id: string }>(`SELECT status, rating, artist_id FROM reviews WHERE booking_id = $1`, [b]))[0];
    expect(r).toMatchObject({ status: "pending", rating: 4, artist_id: artist });
  });
});
