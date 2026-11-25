import "server-only";
import crypto from "node:crypto";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb, Queryable } from "./db";
import { currentUser, startSession } from "./auth";
import { hashPassword } from "./crypto";
import type { VerifiedIdentity } from "./one-eighty";

// Artists sign in with 180 Identity, matched to their application by verified email (and, after the
// first sign-in, by the bound 180 subject). They then get a normal staff session with role 'artist'.

export type ArtistStatus = "pending" | "active" | "suspended" | "rejected";

export interface ArtistAccount {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  email: string | null;
  phone: string;
  status: ArtistStatus;
  rejection_reason: string | null;
  photo_url: string | null;
}

/** Why an identity did (not) match an artist application (shown to the person signing in). */
export type ArtistMatchReason = "bound" | "email" | "phone" | "no_contact" | "unverified" | "bound_elsewhere" | "not_found";

/** 180 phone claim -> the +91XXXXXXXXXX form artist applications are stored in (null if not an Indian mobile). */
export function normaliseIndianPhone(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/[\s()-]/g, "");
  const ten = d.startsWith("+91") ? d.slice(3) : d.startsWith("91") && d.length === 12 ? d.slice(2) : d.replace(/^0/, "");
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}

/**
 * Finds the artist an identity belongs to: the bound 180 subject first, then the application's email, then its
 * phone number (email/phone only when 180 does not mark them unverified). An application already bound to a
 * different 180 account is never taken over.
 */
export async function matchArtistForIdentity(q: Queryable, id: VerifiedIdentity): Promise<{ artistId: string | null; reason: ArtistMatchReason }> {
  const bySub = await q.query<{ id: string }>(`SELECT id FROM artists WHERE identity_sub = $1`, [id.sub]);
  if (bySub[0]) return { artistId: bySub[0].id, reason: "bound" };
  const phone = normaliseIndianPhone(id.phone);
  if (!id.email && !phone) return { artistId: null, reason: "no_contact" };
  let elsewhere = false;
  let unverified = false;
  const tries: Array<["email" | "phone", string | null, boolean]> = [
    ["email", id.email, id.emailVerified],
    ["phone", phone, id.phoneVerified],
  ];
  for (const [kind, value, verified] of tries) {
    if (!value) continue;
    const rows = await q.query<{ id: string; identity_sub: string | null }>(
      kind === "email" ? `SELECT id, identity_sub FROM artists WHERE email = $1` : `SELECT id, identity_sub FROM artists WHERE phone = $1`,
      [value],
    );
    const a = rows[0];
    if (!a) continue;
    if (!verified) {
      unverified = true;
      continue;
    }
    if (a.identity_sub && a.identity_sub !== id.sub) {
      elsewhere = true;
      continue;
    }
    return { artistId: a.id, reason: kind };
  }
  return { artistId: null, reason: elsewhere ? "bound_elsewhere" : unverified ? "unverified" : "not_found" };
}

/** Finds the artist an identity belongs to (see matchArtistForIdentity). */
export async function findArtistForIdentity(q: Queryable, id: VerifiedIdentity) {
  return (await matchArtistForIdentity(q, id)).artistId;
}

/**
 * Ensures the artist has a login user (role 'artist', no usable password: sign-in is through
 * 180 Identity) and starts a session for it.
 */
export async function startArtistSession(artistId: string, identitySub: string | null) {
  const db = await getDb();
  const userId = await db.tx(async (q) => {
    const a = (await q.query<{ user_id: string | null; name: string; email: string | null }>(`SELECT user_id, name, email FROM artists WHERE id = $1 FOR UPDATE`, [artistId]))[0];
    if (!a) throw new Error("Artist not found");
    if (identitySub) await q.query(`UPDATE artists SET identity_sub = COALESCE(identity_sub, $2) WHERE id = $1`, [artistId, identitySub]);
    if (a.user_id) {
      await q.query(`UPDATE users SET active = true WHERE id = $1 AND role = 'artist'`, [a.user_id]);
      return a.user_id;
    }
    if (!a.email) throw new Error("Artist has no email");
    const existing = (await q.query<{ id: string; role: string }>(`SELECT id, role FROM users WHERE email = $1`, [a.email]))[0];
    if (existing && existing.role !== "artist") throw new Error("This email belongs to a staff account. Use a different email for your artist account.");
    const uid =
      existing?.id ??
      (
        await q.query<{ id: string }>(`INSERT INTO users(email, name, password_hash, role) VALUES ($1, $2, $3, 'artist') RETURNING id`, [
          a.email,
          a.name,
          hashPassword(crypto.randomBytes(32).toString("base64url")), // unusable random password
        ])
      )[0].id;
    await q.query(`UPDATE artists SET user_id = $2 WHERE id = $1`, [artistId, uid]);
    return uid;
  });
  await startSession(userId);
}

/** The signed-in artist, or null (memoised per request). */
export const currentArtist = cache(async (): Promise<ArtistAccount | null> => {
  const user = await currentUser();
  if (!user || user.role !== "artist" || !user.artist_id) return null;
  const db = await getDb();
  const rows = await db.query<ArtistAccount>(
    `SELECT id, user_id, slug, name, email, phone, status, rejection_reason, photo_url FROM artists WHERE id = $1`,
    [user.artist_id],
  );
  return rows[0] ?? null;
});

/** For artist pages and actions. `active` additionally requires an approved, non-suspended artist. */
export async function requireArtist(opts: { active?: boolean } = {}): Promise<ArtistAccount> {
  const a = await currentArtist();
  if (!a) redirect("/account?artist=1");
  if (opts.active && a.status !== "active") redirect("/artist-portal");
  return a;
}

export class ArtistAccessError extends Error {}

/** For server actions: throws instead of redirecting, so the form shows a message. */
export async function artistForAction(opts: { active?: boolean } = {}): Promise<ArtistAccount> {
  const a = await currentArtist();
  if (!a) throw new ArtistAccessError("Your session has ended. Please sign in again.");
  if (opts.active && a.status !== "active") throw new ArtistAccessError("Your artist account is not active yet.");
  return a;
}

export function devLoginEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_LOGIN === "1";
}
