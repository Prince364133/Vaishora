"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signInWith180 } from "@/lib/one-eighty/client";
import { refreshSiteAccount } from "@/components/site/site-account";

/**
 * The website's one sign-in. 180 Identity decides who you are; the server routes by role: artists go to
 * their portal, everyone else to their bookings.
 */
type ArtistCheck = { reason?: string; email?: string | null; phone?: string | null };

/** Explains exactly why a 180 sign-in did not open the artist portal. */
function artistHint(c: ArtistCheck | undefined): string {
  const who = [c?.email, c?.phone].filter(Boolean).join(" / ");
  switch (c?.reason) {
    case "no_contact":
      return "Your 180 account did not share an email or phone number with us, so we could not find your artist application. Allow email and phone access when signing in, or use the 180 account with your application email.";
    case "unverified":
      return `Your 180 account (${who}) matches an artist application, but 180 has not verified that email or phone yet. Verify it in your 180 profile, then sign in again.`;
    case "bound_elsewhere":
      return `The artist application for ${who} is already linked to a different 180 account. Sign in with that account, or contact VAISHORA support to move it.`;
    case "not_found":
      return `You signed in to 180 as ${who || "an account without an email"}, but no artist application uses that email or phone number. Sign in with the 180 account that has the same email as your “Become an artist” form, or apply first.`;
    default:
      return "You are signed in, but this account is not linked to an artist application. Use the email from your “Become an artist” form, or apply first.";
  }
}

export function AccountAuthCard({ artistMode = false, applied = false, devLogin = false }: { artistMode?: boolean; applied?: boolean; devLogin?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [devEmail, setDevEmail] = useState("");

  async function finish(res: Response) {
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Sign-in could not be completed.");
    if (json.role === "artist") {
      window.location.assign(json.redirect ?? "/artist-portal");
      return;
    }
    if (artistMode) setError(artistHint(json.artistCheck));
    await refreshSiteAccount();
    router.refresh();
  }

  async function handleSignIn() {
    setBusy(true);
    setError("");
    try {
      const result = await signInWith180();
      if (!result) return; // closed the sheet
      await finish(await fetch("/api/auth/180", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) }));
    } catch (e) {
      setError((e as Error).message || "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function devSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await finish(await fetch("/api/auth/artist-dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: devEmail }) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      {applied && (
        <div className="rounded-[var(--radius-md)] border border-success/30 bg-[#eef6f1] p-4 text-sm" role="status">
          <p className="font-semibold text-success">Application received</p>
          <p className="mt-1">Sign in with the same email you applied with. Your artist portal will show your verification status, and you can set up your profile while we review.</p>
        </div>
      )}
      <div className="card p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-blush text-plum">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div>
            <h2 className="font-display text-2xl text-plum">{artistMode ? "Sign in to your artist portal" : "Sign in to your account"}</h2>
            <p className="text-sm text-muted">{artistMode ? "Use the email from your artist application." : "Your bookings and appointment details. Artists are taken to their portal."}</p>
          </div>
        </div>

        <div className="mt-6 border-t hairline pt-5">
          <p className="text-sm text-plum-ink">Secure sign-in with 180 Identity — no password needed.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={handleSignIn} disabled={busy} className="btn btn-primary min-h-11 px-6 text-base font-semibold">
              {busy ? "Opening secure sign-in…" : "Sign in with 180"}
            </button>
            {!artistMode && (
              <Link href="/booking/find" className="btn btn-secondary min-h-11 px-5">
                Find booking by ID & phone
              </Link>
            )}
          </div>
          {error && (
            <p className="mt-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>

        {devLogin && (
          <form onSubmit={devSignIn} className="mt-6 rounded-[var(--radius-sm)] border border-dashed border-gold p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Local development only — artist sign-in by email</p>
            <div className="mt-2 flex gap-2">
              <label className="sr-only" htmlFor="dev-email">
                Artist email
              </label>
              <input id="dev-email" type="email" required value={devEmail} onChange={(e) => setDevEmail(e.target.value)} className="input" autoComplete="email" />
              <button className="btn btn-secondary flex-none" disabled={busy}>
                Go
              </button>
            </div>
          </form>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t hairline pt-4 text-sm text-muted">
          {artistMode ? (
            <>
              <span>Not an artist with us yet?</span>
              <Link href="/become-an-artist" className="link font-medium text-plum">
                Apply to join VAISHORA →
              </Link>
            </>
          ) : (
            <>
              <span>Don&rsquo;t have a booking yet?</span>
              <Link href="/designs" className="link font-medium text-plum">
                Browse designs & book an artist →
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
