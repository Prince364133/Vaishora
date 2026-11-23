import { z } from "zod";
import { getDb } from "@/server/db";
import { getBookingByToken } from "@/server/bookings";
import { fail, handleError, limit, ok, readJson } from "@/server/http";

// A customer reviews their own COMPLETED booking (identified by the private booking token).
// Reviews start as "pending" and appear on the site only after admin moderation.
const schema = z.object({
  token: z.string().min(20).max(100),
  rating: z.coerce.number().int().min(1).max(5),
  body: z.string().trim().min(10, "Please write at least a sentence").max(1000),
});

export async function POST(req: Request) {
  const limited = limit(req, "review", 5, 10 * 60_000);
  if (limited) return limited;
  try {
    const b = schema.parse(await readJson(req));
    const booking = await getBookingByToken(b.token);
    if (!booking) return fail("Booking not found", 404);
    if (booking.status !== "completed") return fail("You can review a booking after the session is completed.", 409);
    const db = await getDb();
    const rows = await db.query<{ id: string }>(
      `INSERT INTO reviews(booking_id, artist_id, customer_id, rating, body, source, status)
       SELECT b.id, b.artist_id, b.customer_id, $2, $3, 'booking', 'pending' FROM bookings b WHERE b.id = $1
       ON CONFLICT (booking_id) DO NOTHING RETURNING id`,
      [booking.id, b.rating, b.body],
    );
    if (!rows.length) return fail("You have already reviewed this booking. Thank you!", 409);
    return ok({ received: true }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
