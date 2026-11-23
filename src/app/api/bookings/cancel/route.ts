import { z } from "zod";
import { getBookingByToken, refundEntitlement } from "@/server/bookings";
import { cancelWithRefund } from "@/server/payments/service";
import { getSettings } from "@/server/settings";
import { fail, handleError, limit, ok, readJson } from "@/server/http";

const CANCELLABLE = ["pending_payment", "awaiting_artist_assignment", "awaiting_artist_confirmation", "confirmed"];

export async function POST(req: Request) {
  const limited = limit(req, "cancel", 10, 10 * 60_000);
  if (limited) return limited;
  try {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(await readJson(req));
    const booking = await getBookingByToken(token);
    if (!booking) return fail("Booking not found", 404);
    if (!CANCELLABLE.includes(booking.status)) return fail("This booking can no longer be cancelled online. Please contact support.", 409);
    const settings = await getSettings();
    const ent = refundEntitlement(booking, settings);
    const result = await cancelWithRefund(booking.id, ent.amount, { type: "customer" }, "Cancelled by customer");
    return ok({ refunded_paise: result.refunded });
  } catch (e) {
    return handleError(e);
  }
}
