import { z } from "zod";
import { getDb } from "@/server/db";
import { getCustomer, startCustomerSession } from "@/server/customer-auth";
import { fail, handleError, limit, ok, readJson } from "@/server/http";
import { phoneSchema } from "@/lib/schemas";

// Guest checkout, used while 180 Identity sign-in is unavailable (NEXT_PUBLIC_180_IDENTITY=off) or
// fails. The guest's submitted details always overwrite the stored ones, so a guest session can
// never read someone else's saved address. Phone numbers linked to a 180 account must sign in.
const schema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  phone: phoneSchema,
  email: z.string().trim().email("Enter a valid email").max(120),
  gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say"], { error: "Choose an option" }),
  website: z.string().max(0).optional(),
});

export async function POST(req: Request) {
  const limited = limit(req, "guest", 10, 10 * 60_000);
  if (limited) return limited;
  try {
    const p = schema.parse(await readJson(req));
    const db = await getDb();
    const id = await db.tx(async (q) => {
      const existing = (await q.query<{ id: string; identity_sub: string | null }>(`SELECT id, identity_sub FROM customers WHERE phone = $1`, [p.phone]))[0];
      if (existing?.identity_sub) return null;
      // A guest session never sees earlier saved addresses of this phone number: they are cleared.
      const vals = [p.name, p.phone, p.email, p.gender];
      if (existing) {
        await q.query(
          `UPDATE customers SET name=$2, phone=$3, email=$4, gender=$5, address_line=NULL, locality_id=NULL, landmark=NULL, profile_completed_at=now(), updated_at=now() WHERE id=$1`,
          [existing.id, ...vals],
        );
        await q.query(`DELETE FROM customer_addresses WHERE customer_id = $1`, [existing.id]);
        return existing.id;
      }
      const r = await q.query<{ id: string }>(
        `INSERT INTO customers(name, phone, email, gender, profile_completed_at) VALUES ($1,$2,$3,$4,now()) RETURNING id`,
        vals,
      );
      return r[0].id;
    });
    if (!id) return fail("This number has a VAISHORA account. Please sign in to continue.", 409, { field: "phone" });
    await startCustomerSession(id, db);
    return ok({ customer: await getCustomer(id, db) });
  } catch (e) {
    return handleError(e);
  }
}
