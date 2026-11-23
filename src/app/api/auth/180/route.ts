import { z } from "zod";
import { getDb } from "@/server/db";
import { OneEightyError, verifyIdentityResult } from "@/server/one-eighty";
import { getCustomer, startCustomerSession } from "@/server/customer-auth";
import { fail, handleError, limit, ok, readJson } from "@/server/http";

// Completes 180 Identity sign-in: verify server-side, find or create the customer, start a session.
const schema = z.object({
  code: z.string().max(2000).optional(),
  idToken: z.string().max(8000).optional(),
  id_token: z.string().max(8000).optional(),
  redirectUri: z.string().url().max(500).optional(),
  codeVerifier: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const limited = limit(req, "auth-180", 20, 10 * 60_000);
  if (limited) return limited;
  try {
    const b = schema.parse(await readJson(req, 20_000));
    const origin = new URL(req.url).origin;
    const id = await verifyIdentityResult({
      code: b.code,
      idToken: b.idToken ?? b.id_token,
      redirectUri: b.redirectUri ?? `${origin}/oauth/callback`,
      codeVerifier: b.codeVerifier,
    });
    const db = await getDb();
    const customerId = await db.tx(async (q) => {
      const existing = await q.query<{ id: string }>(`SELECT id FROM customers WHERE identity_sub = $1`, [id.sub]);
      if (existing[0]) return existing[0].id;
      // Link to an earlier guest booking record only by a verified email.
      if (id.email) {
        const byEmail = await q.query<{ id: string }>(`SELECT id FROM customers WHERE lower(email) = $1 AND identity_sub IS NULL LIMIT 1`, [id.email]);
        if (byEmail[0]) {
          await q.query(`UPDATE customers SET identity_sub = $2, updated_at = now() WHERE id = $1`, [byEmail[0].id, id.sub]);
          return byEmail[0].id;
        }
      }
      const phone = id.phone && /^\+91[6-9]\d{9}$/.test(id.phone) ? id.phone : null;
      const phoneTaken = phone ? (await q.query(`SELECT 1 FROM customers WHERE phone = $1`, [phone])).length > 0 : false;
      const r = await q.query<{ id: string }>(`INSERT INTO customers(identity_sub, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING id`, [
        id.sub,
        id.name ?? "",
        id.email,
        phoneTaken ? null : phone,
      ]);
      return r[0].id;
    });
    await startCustomerSession(customerId, db);
    return ok({ customer: await getCustomer(customerId, db) });
  } catch (e) {
    if (e instanceof OneEightyError) return fail(e.message, e.status);
    return handleError(e);
  }
}
