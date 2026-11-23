import { z } from "zod";
import { getDb } from "@/server/db";
import { fail, handleError, limit, ok, readJson } from "@/server/http";
import { phoneSchema } from "@/lib/schemas";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  phone: phoneSchema,
  bookingCode: z.string().trim().max(20).optional(),
  message: z.string().trim().min(5, "Tell us a little more").max(1000),
  website: z.string().max(0).optional(),
});

export async function POST(req: Request) {
  const limited = limit(req, "support", 5, 10 * 60_000);
  if (limited) return limited;
  try {
    const raw = (await readJson(req)) as Record<string, unknown>;
    if (raw?.website) return fail("Request rejected", 400);
    const b = schema.parse(raw);
    const db = await getDb();
    await db.query(`INSERT INTO support_requests(name, phone, booking_code, message) VALUES ($1,$2,$3,$4)`, [b.name, b.phone, b.bookingCode || null, b.message]);
    return ok({ received: true }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
