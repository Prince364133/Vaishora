"use client";

import { useEffect, useState } from "react";
import { signInWith180 } from "@/lib/one-eighty/client";

// Who is signed in on the website, shared by the header and the mobile tab bar (one request per page load).

export interface SiteAccount {
  customer: { id: string; name: string; phone: string | null; email: string | null } | null;
  artist: { name: string; status: string } | null;
}

let cache: Promise<SiteAccount> | null = null;
const listeners = new Set<(a: SiteAccount) => void>();

export function loadSiteAccount(force = false): Promise<SiteAccount> {
  if (!cache || force)
    cache = fetch("/api/account", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}) as Promise<Partial<SiteAccount>>)
      .then((j) => ({ customer: j.customer ?? null, artist: j.artist ?? null }))
      .catch(() => ({ customer: null, artist: null }));
  return cache;
}

/** Re-reads who is signed in and updates the header and tab bar (after sign-in / sign-out elsewhere). */
export async function refreshSiteAccount() {
  const a = await loadSiteAccount(true);
  listeners.forEach((l) => l(a));
}

export function useSiteAccount() {
  const [account, setAccount] = useState<SiteAccount | null>(null);
  useEffect(() => {
    let live = true;
    void loadSiteAccount().then((a) => live && setAccount(a));
    const on = (a: SiteAccount) => setAccount(a);
    listeners.add(on);
    return () => {
      live = false;
      listeners.delete(on);
    };
  }, []);
  return account;
}

/**
 * Opens the 180 Identity sheet and completes sign-in. Artists are sent to their portal; customers stay
 * and the shared account state updates. Returns false when the sheet was closed.
 */
export async function siteSignIn(): Promise<boolean> {
  const result = await signInWith180();
  if (!result) return false;
  const res = await fetch("/api/auth/180", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Sign-in could not be completed.");
  if (json.role === "artist") {
    window.location.assign(json.redirect ?? "/artist-portal");
    return true;
  }
  const a = await loadSiteAccount(true);
  listeners.forEach((l) => l(a));
  return true;
}
