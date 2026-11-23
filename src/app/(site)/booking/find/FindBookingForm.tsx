"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function FindBookingForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch("/api/bookings/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Booking not found");
    router.push(`/booking/${json.token}`);
  }
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div className="field">
        <label htmlFor="code">Booking ID</label>
        <input id="code" name="code" required className="input uppercase" placeholder="VSH-XXXXXX" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
      </div>
      <div className="field">
        <label htmlFor="phone">Mobile number</label>
        <input id="phone" name="phone" type="tel" inputMode="tel" required className="input" autoComplete="tel" enterKeyHint="search" />
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="btn btn-primary w-full sm:w-auto" disabled={busy}>{busy ? "Finding…" : "Find booking"}</button>
    </form>
  );
}
