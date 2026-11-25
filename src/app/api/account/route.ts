import { z } from "zod";
import { getDb } from "@/server/db";
import { currentCustomer, endCustomerSession, getCustomer, isProfileComplete } from "@/server/customer-auth";
import { currentArtist } from "@/server/artist-auth";
import { after } from "next/server";
import { maybeSendReviewRequests } from "@/server/reviews";
import { fail, handleError, limit, ok, readJson } from "@/server/http";
import { phoneSchema } from "@/lib/schemas";

// GET: the signed-in customer (or null). PUT: complete/update the quick checkout profile.
// DELETE: sign out.

export async function GET() {
  // Every page load asks who is signed in: a cheap, throttled moment to send due "rate your artist" emails.
  after(() => maybeSendReviewRequests());
  const [c, a] = await Promise.all([currentCustomer(), currentArtist()]);
  return ok({ customer: c, artist: a ? { name: a.name, status: a.status } : null });
}

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  phone: phoneSchema,
  email: z.string().trim().email("Enter a valid email").max(120),
  gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say"], { error: "Choose an option" }),
});

export async function PUT(req: Request) {
  const limited = limit(req, "profile", 20, 10 * 60_000);
  if (limited) return limited;
  try {
    const me = await currentCustomer();
    if (!me) return fail("Please sign in again.", 401);
    const p = profileSchema.parse(await readJson(req));
    const db = await getDb();
    const clash = await db.query(`SELECT 1 FROM customers WHERE phone = $1 AND id <> $2`, [p.phone, me.id]);
    if (clash.length) return fail("This mobile number is linked to another account. Sign in with that number or contact support.", 409);
    await db.query(
      `UPDATE customers SET name=$2, phone=$3, email=$4, gender=$5,
         profile_completed_at = COALESCE(profile_completed_at, now()), updated_at = now() WHERE id = $1`,
      [me.id, p.name, p.phone, p.email, p.gender],
    );
    const c = await getCustomer(me.id, db);
    return ok({ customer: c, complete: c ? isProfileComplete(c) : false });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE() {
  await endCustomerSession();
  return ok({ signedOut: true });
}
