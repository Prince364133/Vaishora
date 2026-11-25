import { z } from "zod";
import { getDb } from "@/server/db";
import { getBookingByToken } from "@/server/bookings";
import { ReviewError, submitBookingReview } from "@/server/reviews";
import { notifyTeam } from "@/server/email";
import { fail, handleError, limit, ok, readJson } from "@/server/http";

// A customer rates their artist once the booked time is over (booking identified by its private token).
// Reviews start as "pending" and appear on the site after moderation.
const schema = z.object({
  token: z.string().min(20).max(100),
  rating: z.coerce.number().int().min(1, "Choose a rating").max(5),
  body: z.string().trim().max(1000).optional().default(""),
});

export async function POST(req: Request) {
  const limited = limit(req, "review", 10, 10 * 60_000);
  if (limited) return limited;
  try {
    const b = schema.parse(await readJson(req));
    const booking = await getBookingByToken(b.token);
    if (!booking) return fail("Booking not found", 404);
    const id = await submitBookingReview(await getDb(), booking.id, b.rating, b.body);
    notifyTeam({
      template: "review_new",
      artistId: booking.artist_id,
      subject: `New ${b.rating}★ review for ${booking.artist_name ?? "an artist"}`,
      heading: "A customer rated their artist",
      paragraphs: [`${"★".repeat(b.rating)}${"☆".repeat(5 - b.rating)} for ${booking.artist_name ?? "the artist"} (${booking.design_name}, ${booking.code}).`, b.body || "(no comment)"],
      path: "/admin/reviews",
    });
    return ok({ received: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof ReviewError) return fail(e.message, e.status);
    return handleError(e);
  }
}
