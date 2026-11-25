import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false } };

/**
 * Local development only: makes sure the bootstrap admin from ADMIN_EMAIL / ADMIN_PASSWORD exists and can
 * sign in. Never runs in production. (Artists have no passwords: they sign in on the website with 180 Identity.)
 */
async function DevAdminBootstrap() {
  await connection();
  if (process.env.NODE_ENV === "production") return null;
  const email = (process.env.ADMIN_EMAIL ?? "admin@vaishora.local").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "admin123";
  try {
    const db = await getDb();
    const { hashPassword, verifyPassword } = await import("@/server/crypto");
    const u = (await db.query<{ active: boolean; password_hash: string }>(`SELECT active, password_hash FROM users WHERE email = $1 AND role = 'admin'`, [email]))[0];
    if (!u) {
      const taken = await db.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
      if (!taken.length) await db.query(`INSERT INTO users(email, name, password_hash, role, active) VALUES ($1, 'VAISHORA Admin', $2, 'admin', true)`, [email, hashPassword(password)]);
    } else if (!u.active || !verifyPassword(password, u.password_hash)) {
      await db.query(`UPDATE users SET password_hash = $1, active = true WHERE email = $2 AND role = 'admin'`, [hashPassword(password), email]);
    }
  } catch {
    /* non-blocking in development */
  }
  return (
    <div className="mt-6 border-t border-[var(--color-line)] pt-4 text-xs text-muted">
      <p className="font-semibold text-plum">Local development</p>
      <p className="mt-1">
        Admin: <code className="rounded bg-blush px-1 py-0.5 text-plum">{email}</code> (password from <code>ADMIN_PASSWORD</code>)
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-plum px-4 py-8">
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] bg-ivory p-6 shadow-[var(--shadow-lift)] sm:p-7">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/emblem.png" alt="" className="h-10 w-auto" />
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-blush px-3 py-1 text-xs font-semibold text-plum">✦ Admin</div>
        <h1 className="mt-2 text-3xl">Sign in</h1>
        <p className="text-sm text-muted">For VAISHORA staff and administrators.</p>
        <LoginForm />
        <p className="mt-5 text-sm text-muted">
          Are you an artist?{" "}
          <Link href="/account?artist=1" className="link">
            Sign in on the website
          </Link>
        </p>
        <Suspense fallback={null}>
          <DevAdminBootstrap />
        </Suspense>
      </div>
    </main>
  );
}
