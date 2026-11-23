import { z } from "zod";
import { getDb } from "@/server/db";
import { bookingAccessToken } from "@/server/bookings";
import { fail, handleError, limit, ok, readJson } from "@/server/http";
import { phoneSchema } from "@/lib/schemas";

// Requires both the booking ID and the phone number; strictly rate limited against guessing.
export async function POST(req: Request) {
  const limited = limit(req, "find-booking", 8, 15 * 60_000);
  if (limited) return limited;
  try {
    const { code, phone } = z.object({ code: z.string().trim().toUpperCase().regex(/^VSH-[A-Z0-9]{6}$/, "Booking ID looks like VSH-XXXXXX"), phone: phoneSchema }).parse(await readJson(req));
    const db = await getDb();
    const rows = await db.query<{ id: string }>(`SELECT b.id FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE b.code = $1 AND c.phone = $2`, [code, phone]);
    if (!rows[0]) return fail("We couldn’t find a booking with that ID and mobile number.", 404);
    return ok({ token: bookingAccessToken(rows[0].id) });
  } catch (e) {
    return handleError(e);
  }
}
