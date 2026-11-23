import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-plum px-4 py-8">
      <div className="w-full max-w-sm rounded-[var(--radius-lg)] bg-ivory p-6 sm:p-7 shadow-[var(--shadow-lift)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/emblem.png" alt="" className="h-10 w-auto" />
        <h1 className="mt-3 text-3xl">Sign in</h1>
        <p className="text-sm text-muted">For VAISHORA team members and artists.</p>
        <LoginForm />
      </div>
    </main>
  );
}
