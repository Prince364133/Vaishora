"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { siteSignIn, useSiteAccount } from "./site-account";

/** Header account button: "Log in" (180 Identity sheet), the customer's first name, or "Artist portal". */
export function HeaderAccount({ mobile = false }: { mobile?: boolean }) {
  const router = useRouter();
  const account = useSiteAccount();
  const [busy, setBusy] = useState(false);
  const customer = account?.customer ?? null;
  const artist = account?.artist ?? null;

  async function handleLogin() {
    if (artist) return router.push("/artist-portal");
    if (customer) return router.push("/account");
    setBusy(true);
    try {
      const done = await siteSignIn();
      if (!done) router.push("/account");
      else router.refresh();
    } catch {
      router.push("/account");
    } finally {
      setBusy(false);
    }
  }

  const first = customer?.name?.trim().split(/\s+/)[0];
  const label = artist ? "Artist portal" : customer ? first || "Account" : busy ? "Signing in…" : "Log in";

  if (mobile) {
    return (
      <button type="button" onClick={handleLogin} disabled={busy} className="flex min-h-14 w-full items-center justify-between border-b hairline text-left font-display text-[1.65rem] text-plum">
        <span>{artist ? "Artist portal" : customer ? "My account" : "Sign in / Account"}</span>
        <span className="rounded bg-blush px-2.5 py-1 font-sans text-xs font-semibold tracking-wide text-plum-ink uppercase">
          {artist ? artist.name.split(" ")[0] : customer ? first || "Signed in" : "180 Auth"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleLogin}
      disabled={busy}
      className="btn btn-ghost btn-sm inline-flex items-center gap-1.5 px-3 text-sm text-plum"
      title={customer ? `Signed in as ${customer.name || customer.email || customer.phone}` : "Sign in to your VAISHORA account"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
      <span className="max-w-28 truncate">{label}</span>
    </button>
  );
}
