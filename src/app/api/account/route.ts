import { z } from "zod";
import { getDb } from "@/server/db";
import { currentCustomer, endCustomerSession, getCustomer, isProfileComplete } from "@/server/customer-auth";
import { fail, handleError, limit, ok, readJson } from "@/server/http";
import { phoneSchema } from "@/lib/schemas";

// GET: the signed-in customer (or null). PUT: complete/update the quick checkout profile.
// DELETE: sign out.

export async function GET() {
  const c = await currentCustomer();
  return ok({ customer: c });
}

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  phone: phoneSchema,
  email: z.string().trim().email("Enter a valid email").max(120),
  gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say"], { error: "Choose an option" }),
  address_line: z.string().trim().min(8, "Enter the full address — house/flat number and street").max(240),
  locality_id: z.coerce.number().int().positive("Choose your locality"),
  landmark: z.string().trim().max(120).default(""),
});

export async function PUT(req: Request) {
  const limited = limit(req, "profile", 20, 10 * 60_000);
  if (limited) return limited;
  try {
    const me = await currentCustomer();
    if (!me) return fail("Please sign in again.", 401);
    const p = profileSchema.parse(await readJson(req));
    const db = await getDb();
    const loc = await db.query(`SELECT 1 FROM localities WHERE id = $1 AND active`, [p.locality_id]);
    if (!loc.length) return fail("We do not serve this locality yet.", 422);
    const clash = await db.query(`SELECT 1 FROM customers WHERE phone = $1 AND id <> $2`, [p.phone, me.id]);
    if (clash.length) return fail("This mobile number is linked to another account. Sign in with that number or contact support.", 409);
    await db.query(
      `UPDATE customers SET name=$2, phone=$3, email=$4, gender=$5, address_line=$6, locality_id=$7, landmark=$8,
         profile_completed_at = COALESCE(profile_completed_at, now()), updated_at = now() WHERE id = $1`,
      [me.id, p.name, p.phone, p.email, p.gender, p.address_line, p.locality_id, p.landmark],
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
