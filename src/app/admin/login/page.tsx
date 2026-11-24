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

  // Ensure demo artist account exists in development so port 3001 can be tested immediately
  if (process.env.NODE_ENV !== "production") {
    try {
      const db = await getDb();
      const artist = await db.query<{ id: string }>("SELECT id FROM users WHERE email = 'artist@vaishora.local'");
      let uId = artist[0]?.id;
      if (!uId) {
        const { hashPassword } = await import("@/server/crypto");
        const u = await db.query<{ id: string }>(
          `INSERT INTO users(email, name, password_hash, role) VALUES ('artist@vaishora.local', 'Demo Artist A', $1, 'artist') RETURNING id`,
          [hashPassword("artist12345")],
        );
        uId = u[0].id;
      }
      await db.query(`UPDATE artists SET user_id = $1 WHERE (slug = 'demo-artist-a' OR user_id IS NULL) AND (user_id IS NULL OR user_id = $1)`, [uId]);
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
