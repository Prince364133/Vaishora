import { z } from "zod";
import { getDb } from "@/server/db";
import { getBookingByToken } from "@/server/bookings";
import { skipBookingReview } from "@/server/reviews";
import { fail, handleError, limit, ok, readJson } from "@/server/http";

// "Skip" on the rate-your-artist prompt: we will not ask about this booking again.
export async function POST(req: Request) {
  const limited = limit(req, "review-skip", 20, 10 * 60_000);
  if (limited) return limited;
  try {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(await readJson(req));
    const booking = await getBookingByToken(token);
    if (!booking) return fail("Booking not found", 404);
    await skipBookingReview(await getDb(), booking.id);
    return ok({ skipped: true });
  } catch (e) {
    return handleError(e);
  }
}
