"use client";

import { useState } from "react";
import { signInWith180 } from "@/lib/one-eighty/client";

export interface CustomerLite {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  address_line: string | null;
  locality_id: number | null;
  landmark: string | null;
  profile_complete: boolean;
}

const GENDERS = [
  { v: "female", l: "Female" },
  { v: "male", l: "Male" },
  { v: "non_binary", l: "Non-binary" },
  { v: "prefer_not_to_say", l: "Prefer not to say" },
];

/** Step 1 of checkout: sign in through the 180 Identity bottom sheet. */
export const IDENTITY_ENABLED = process.env.NEXT_PUBLIC_180_IDENTITY !== "off";

export function SignInCard({ onSignedIn, onGuest }: { onSignedIn: (c: CustomerLite) => void; onGuest: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setBusy(true);
    setError("");
    try {
      const result = await signInWith180();
      if (!result) {
        setBusy(false);
        return; // closed the sheet
      }
      const res = await fetch("/api/auth/180", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Sign-in could not be completed");
      onSignedIn(json.customer);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card p-5">
      <h3 className="font-sans text-lg font-semibold text-plum-ink">Sign in to confirm your booking</h3>
      <p className="mt-1 text-sm text-muted">One tap with WhatsApp, phone or email — no password to create. We only use it for this booking and its updates.</p>
      <button type="button" className="btn btn-primary mt-4 w-full sm:w-auto" onClick={go} disabled={busy}>
        {busy ? "Opening secure sign-in…" : "Continue"}
      </button>
      {error && <p className="field-error mt-2" role="alert">{error}</p>}
      <button type="button" className="btn btn-ghost mt-2 w-full px-0 text-sm sm:w-auto" onClick={onGuest}>
        Continue with just your details
      </button>
    </div>
  );
}

/** Step 2 of checkout: quick profile — only name, phone, email, gender and address. */
export function QuickProfile({
  customer,
  localities,
  defaultLocalityId,
  onSaved,
  guest = false,
}: {
  guest?: boolean;
  customer: CustomerLite;
  localities: { id: number; name: string }[];
  defaultLocalityId: number | "";
  onSaved: (c: CustomerLite) => void;
}) {
  const [f, setF] = useState({
    name: customer.name || "",
    phone: (customer.phone ?? "").replace(/^\+91/, ""),
    email: customer.email ?? "",
    gender: customer.gender ?? "",
    address_line: customer.address_line ?? "",
    locality_id: (customer.locality_id ?? defaultLocalityId) as number | "",
    landmark: customer.landmark ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(guest ? "/api/auth/guest" : "/api/account", {
      method: guest ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError({ field: json.field, message: json.error ?? "Could not save" });
    onSaved(json.customer);
  }

  const err = (k: string) => (error?.field === k ? error.message : "");
  return (
    <form onSubmit={save} className="card space-y-4 p-5" noValidate>
      <div>
        <h3 className="font-sans text-lg font-semibold text-plum-ink">A few details for your artist</h3>
        <p className="text-sm text-muted">Asked once. Next time you book on this device, we fill these in for you.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="cp-name">Full name</label>
          <input id="cp-name" className="input" autoComplete="name" value={f.name} onChange={set("name")} aria-invalid={!!err("name")} required />
          {err("name") && <p className="field-error">{err("name")}</p>}
        </div>
        <div className="field">
          <label htmlFor="cp-phone">Mobile number</label>
          <div className="flex">
            <span className="grid place-items-center rounded-l-[var(--radius-sm)] border border-r-0 border-[rgb(75_29_63/0.22)] bg-blush/60 px-3 text-sm">+91</span>
            <input id="cp-phone" className="input rounded-l-none" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={14} value={f.phone} onChange={set("phone")} aria-invalid={!!err("phone")} required />
          </div>
          {err("phone") && <p className="field-error">{err("phone")}</p>}
        </div>
        <div className="field">
          <label htmlFor="cp-email">Email</label>
          <input id="cp-email" className="input" type="email" inputMode="email" autoComplete="email" value={f.email} onChange={set("email")} aria-invalid={!!err("email")} required />
          {err("email") && <p className="field-error">{err("email")}</p>}
        </div>
        <fieldset className="field">
          <legend className="label mb-1">Gender</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {GENDERS.map((g) => (
              <button key={g.v} type="button" role="radio" aria-checked={f.gender === g.v} className="chip min-h-11" onClick={() => setF((p) => ({ ...p, gender: g.v }))}>
                {g.l}
              </button>
            ))}
          </div>
          {err("gender") && <p className="field-error">{err("gender")}</p>}
        </fieldset>
        <div className="field sm:col-span-2">
          <label htmlFor="cp-address">Address where the artist should come</label>
          <textarea id="cp-address" className="input min-h-20" autoComplete="street-address" value={f.address_line} onChange={set("address_line")} aria-invalid={!!err("address_line")} placeholder="Flat / house number, building, street" required />
          {err("address_line") && <p className="field-error">{err("address_line")}</p>}
        </div>
        <div className="field">
          <label htmlFor="cp-locality">Locality (Hyderabad)</label>
          <select id="cp-locality" className="input" value={f.locality_id} onChange={(e) => setF((p) => ({ ...p, locality_id: e.target.value ? Number(e.target.value) : "" }))} aria-invalid={!!err("locality_id")} required>
            <option value="">Choose locality</option>
            {localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {err("locality_id") && <p className="field-error">{err("locality_id")}</p>}
        </div>
        <div className="field">
          <label htmlFor="cp-landmark">Landmark (optional)</label>
          <input id="cp-landmark" className="input" value={f.landmark} onChange={set("landmark")} />
        </div>
      </div>
      {error && !error.field && <p className="field-error" role="alert">{error.message}</p>}
      <button className="btn btn-primary w-full sm:w-auto" disabled={busy}>{busy ? "Saving…" : "Save and continue"}</button>
    </form>
  );
}
