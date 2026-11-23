"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signInWith180 } from "@/lib/one-eighty/client";

interface CustomerData {
  id: string;
  name: string;
  phone: string;
  email: string | null;
}

export function HeaderAccount({ mobile = false }: { mobile?: boolean }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/account")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.customer) setCustomer(data.customer);
      })
      .catch(() => {});
  }, []);

  async function handleLogin(e: React.MouseEvent) {
    if (customer) {
      router.push("/account");
      return;
    }
    e.preventDefault();
    setBusy(true);
    try {
      const result = await signInWith180();
      if (!result) {
        setBusy(false);
        router.push("/account");
        return;
      }
      const res = await fetch("/api/auth/180", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.customer) {
        setCustomer(json.customer);
        router.push("/account");
        router.refresh();
      } else {
        router.push("/account");
      }
    } catch {
      router.push("/account");
    } finally {
      setBusy(false);
    }
  }

  const label = customer
    ? customer.name ? customer.name.split(" ")[0] : "Account"
    : busy
    ? "Signing in…"
    : "Log in";

  if (mobile) {
    return (
      <button
        type="button"
        onClick={handleLogin}
        disabled={busy}
        className="flex min-h-14 items-center justify-between border-b hairline font-display text-[1.65rem] text-plum w-full text-left"
      >
        <span>{customer ? "My Account" : "Sign in / Account"}</span>
        <span className="text-xs font-sans tracking-wide uppercase px-2.5 py-1 rounded bg-blush text-plum-ink font-semibold">
          {customer ? (customer.name ? customer.name.split(" ")[0] : "Signed in") : "180 Auth"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleLogin}
      disabled={busy}
      className="btn btn-ghost btn-sm px-3 text-sm inline-flex items-center gap-1.5 text-plum"
      title={customer ? `Signed in as ${customer.name || customer.phone}` : "Sign in to your Vaishora account"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
