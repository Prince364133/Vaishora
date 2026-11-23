import { createBooking } from "@/server/bookings";
import { currentCustomer, isProfileComplete } from "@/server/customer-auth";
import { fail, handleError, limit, ok, readJson } from "@/server/http";
import { bookingRequestSchema } from "@/lib/schemas";

export async function POST(req: Request) {
  const limited = limit(req, "booking", 10, 10 * 60_000);
  if (limited) return limited;
  try {
    const raw = (await readJson(req)) as Record<string, unknown>;
    if (typeof raw?.website === "string" && raw.website.length > 0) return fail("Request rejected", 400); // honeypot
    const customer = await currentCustomer();
    if (!customer) return fail("Please sign in to confirm your booking.", 401, { code: "auth_required" });
    if (!isProfileComplete(customer)) return fail("Please complete your details first.", 409, { code: "profile_incomplete" });
    const body = bookingRequestSchema.parse(raw);
    const key = req.headers.get("idempotency-key");
    const idem = key && /^[A-Za-z0-9_-]{16,80}$/.test(key) ? key : null;
    const b = await createBooking(body, idem, customer.id);
    return ok(
      { code: b.code, token: b.token, status: b.status, advance_paise: b.advance_paise, total_paise: b.total_paise, hold_expires_at: b.hold_expires_at },
      { status: 201 },
    );
  } catch (e) {
    return handleError(e);
  }
}
