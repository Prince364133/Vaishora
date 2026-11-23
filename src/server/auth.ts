import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { randomToken, sha256, verifyPassword } from "./crypto";

export type Role = "admin" | "staff" | "artist";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  artist_id: string | null;
}

const COOKIE = "vsh_session";
const SESSION_DAYS = 7;

export async function login(email: string, password: string): Promise<SessionUser | null> {
  const db = await getDb();
  const rows = await db.query<SessionUser & { password_hash: string; active: boolean }>(
    `SELECT u.id, u.email, u.name, u.role, u.password_hash, u.active, a.id AS artist_id
     FROM users u LEFT JOIN artists a ON a.user_id = u.id WHERE u.email = $1`,
    [email.trim().toLowerCase()],
  );
  const u = rows[0];
  // Always run a hash comparison to keep timing similar for unknown emails.
  const ok = verifyPassword(password, u?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==");
  if (!u || !u.active || !ok) return null;
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.query(`INSERT INTO sessions(id, user_id, expires_at) VALUES ($1, $2, $3)`, [sha256(token), u.id, expires.toISOString()]);
  await db.query(`DELETE FROM sessions WHERE expires_at < now()`);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
  return { id: u.id, email: u.email, name: u.name, role: u.role, artist_id: u.artist_id };
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.query(`DELETE FROM sessions WHERE id = $1`, [sha256(token)]);
  }
  jar.delete(COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const rows = await db.query<SessionUser>(
    `SELECT u.id, u.email, u.name, u.role, a.id AS artist_id
     FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN artists a ON a.user_id = u.id
     WHERE s.id = $1 AND s.expires_at > now() AND u.active`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

/** Use in server components/actions. Redirects to login when unauthenticated or unauthorised. */
export async function requireRole(roles: Role[], loginPath = "/admin/login"): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(loginPath);
  if (!roles.includes(user.role)) redirect(user.role === "artist" ? "/artist-portal" : "/admin");
  return user;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

export async function audit(userId: string | null, action: string, entity: string, entityId: string | null, details: unknown = {}) {
  const db = await getDb();
  await db.query(`INSERT INTO audit_logs(user_id, action, entity, entity_id, details, ip) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`, [
    userId,
    action,
    entity,
    entityId,
    JSON.stringify(details ?? {}),
    await clientIp().catch(() => null),
  ]);
}
