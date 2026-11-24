import type { Metadata } from "next";
import { headers } from "next/headers";
import { getDb } from "@/server/db";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage() {
  const h = await headers();
  const service = h.get("x-vaishora-service");
  const isArtist = service === "Artists Portal";
  const isAdmin = service === "Admin Portal";

  // Ensure demo admin and artist accounts exist and have active credentials matching dev settings
  if (process.env.NODE_ENV !== "production") {
    try {
      const db = await getDb();
      const { hashPassword, verifyPassword } = await import("@/server/crypto");

      // 1. Admin account sync
      const adminEmail = (process.env.ADMIN_EMAIL ?? "admin@vaishora.local").toLowerCase();
      const adminPass = process.env.ADMIN_PASSWORD ?? "admin123";
      const adminUser = await db.query<{ id: string; active: boolean; password_hash: string }>(
        `SELECT id, active, password_hash FROM users WHERE email = $1`,
        [adminEmail]
      );
      if (!adminUser.length) {
        await db.query(
          `INSERT INTO users(email, name, password_hash, role, active) VALUES ($1, 'VAISHORA Admin', $2, 'admin', true)`,
          [adminEmail, hashPassword(adminPass)]
        );
      } else if (!adminUser[0].active || !verifyPassword(adminPass, adminUser[0].password_hash)) {
        await db.query(
          `UPDATE users SET password_hash = $1, active = true WHERE email = $2`,
          [hashPassword(adminPass), adminEmail]
        );
      }

      // 2. Artist account sync
      const artistEmail = (process.env.ARTIST_EMAIL ?? "artist@vaishora.local").toLowerCase();
      const artistPass = process.env.ARTIST_PASSWORD ?? "artist12345";
      const artistUser = await db.query<{ id: string; active: boolean; password_hash: string }>(
        `SELECT id, active, password_hash FROM users WHERE email = $1`,
        [artistEmail]
      );
      let artistId: string;
      if (!artistUser.length) {
        const u = await db.query<{ id: string }>(
          `INSERT INTO users(email, name, password_hash, role, active) VALUES ($1, 'Demo Artist A', $2, 'artist', true) RETURNING id`,
          [artistEmail, hashPassword(artistPass)]
        );
        artistId = u[0].id;
      } else {
        artistId = artistUser[0].id;
        if (!artistUser[0].active || !verifyPassword(artistPass, artistUser[0].password_hash)) {
          await db.query(
            `UPDATE users SET password_hash = $1, active = true WHERE email = $2`,
            [hashPassword(artistPass), artistEmail]
          );
        }
      }
      await db.query(
        `UPDATE artists SET user_id = $1 WHERE (slug = 'demo-artist-a' OR user_id IS NULL) AND (user_id IS NULL OR user_id = $1)`,
        [artistId]
      );
    } catch {
      // Non-blocking in dev
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-plum px-4 py-8">
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] bg-ivory p-6 sm:p-7 shadow-[var(--shadow-lift)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/emblem.png" alt="" className="h-10 w-auto" />

        {isArtist ? (
          <>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-blush px-3 py-1 text-xs font-semibold text-plum">
              ✦ Artists Portal
            </div>
            <h1 className="mt-2 text-3xl">Sign in</h1>
            <p className="text-sm text-muted">Sign in with your artist account to view and manage your assigned bookings.</p>
          </>
        ) : isAdmin ? (
          <>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-blush px-3 py-1 text-xs font-semibold text-plum">
              ✦ Admin Portal
            </div>
            <h1 className="mt-2 text-3xl">Sign in</h1>
            <p className="text-sm text-muted">For VAISHORA staff and administrators.</p>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-3xl">Sign in</h1>
            <p className="text-sm text-muted">For VAISHORA team members and artists.</p>
          </>
        )}

        <LoginForm />

        {process.env.NODE_ENV !== "production" && (
          <div className="mt-6 border-t border-[var(--color-line)] pt-4 text-xs text-muted">
            <p className="font-semibold text-plum">Development Credentials:</p>
            {isArtist ? (
              <p className="mt-1">
                Artist: <code className="rounded bg-blush px-1 py-0.5 text-plum">artist@vaishora.local</code> / <code className="rounded bg-blush px-1 py-0.5 text-plum">artist12345</code>
              </p>
            ) : (
              <p className="mt-1">
                Admin: <code className="rounded bg-blush px-1 py-0.5 text-plum">admin@vaishora.local</code> / <code className="rounded bg-blush px-1 py-0.5 text-plum">admin123</code>
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
