"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signInWith180 } from "@/lib/one-eighty/client";

export function AccountAuthCard() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn() {
    setBusy(true);
    setError("");
    try {
      const result = await signInWith180();
      if (!result) {
        setBusy(false);
        return; // Closed the sheet
      }
      const res = await fetch("/api/auth/180", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Sign-in could not be completed.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-6 p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blush text-plum">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div>
          <h2 className="font-display text-2xl text-plum">Sign in to your account</h2>
          <p className="text-sm text-muted">Access your bookings, appointment details, and artist assignments.</p>
        </div>
      </div>

      <div className="mt-6 border-t hairline pt-5">
        <p className="text-sm text-plum-ink">
          One-tap secure sign in with WhatsApp, phone number, or email powered by 180 Identity. No password needed.
        </p>

        <div className="mt-4 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleSignIn}
            disabled={busy}
            className="btn btn-primary min-h-11 px-6 text-base font-semibold"
          >
            {busy ? "Opening 180 sign-in…" : "Sign in with 180"}
          </button>
          <Link href="/booking/find" className="btn btn-secondary min-h-11 px-5">
            Find booking by ID & phone
          </Link>
        </div>

        {error && (
          <p className="mt-3 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="mt-6 border-t hairline pt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <span>Don't have a booking yet?</span>
        <Link href="/designs" className="link text-plum font-medium">
          Browse designs & book an artist →
        </Link>
      </div>
    </div>
  );
}
