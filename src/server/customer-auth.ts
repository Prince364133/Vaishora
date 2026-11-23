import "server-only";
import { cookies } from "next/headers";
import { getDb, Queryable } from "./db";
import { randomToken, sha256 } from "./crypto";

// Customer accounts. Customers sign in only when they check out, through the 180 Identity
// bottom sheet; we then keep our own short session cookie. Admin/staff/artist sessions are
// separate (see auth.ts).

const COOKIE = "vsh_customer";
const SESSION_DAYS = 30;

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  gender: "female" | "male" | "non_binary" | "prefer_not_to_say" | null;
  address_line: string | null;
  locality_id: number | null;
  landmark: string | null;
  profile_complete: boolean;
}

const SELECT = `SELECT id, name, phone, email, gender, address_line, locality_id, landmark,
  (profile_completed_at IS NOT NULL) AS profile_complete FROM customers`;

export async function startCustomerSession(customerId: string, q?: Queryable) {
  const db = q ?? (await getDb());
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.query(`INSERT INTO customer_sessions(id, customer_id, expires_at) VALUES ($1, $2, $3)`, [sha256(token), customerId, expires.toISOString()]);
  await db.query(`UPDATE customers SET last_login_at = now() WHERE id = $1`, [customerId]);
  await db.query(`DELETE FROM customer_sessions WHERE expires_at < now()`);
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
}

export async function endCustomerSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await (await getDb()).query(`DELETE FROM customer_sessions WHERE id = $1`, [sha256(token)]);
  jar.delete(COOKIE);
}

export async function currentCustomer(q?: Queryable): Promise<Customer | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = q ?? (await getDb());
  const rows = await db.query<Customer>(
    `${SELECT} WHERE id = (SELECT customer_id FROM customer_sessions WHERE id = $1 AND expires_at > now())`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export async function getCustomer(id: string, q?: Queryable): Promise<Customer | null> {
  const db = q ?? (await getDb());
  return (await db.query<Customer>(`${SELECT} WHERE id = $1`, [id]))[0] ?? null;
}

export function isProfileComplete(c: Customer) {
  return !!(c.name && c.phone && c.email && c.gender && c.address_line && c.locality_id);
}
