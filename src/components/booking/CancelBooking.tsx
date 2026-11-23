"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPaise } from "@/lib/money";

export function CancelBooking({ token, refundPaise, paid }: { token: string; refundPaise: number; paid: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function cancel() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/bookings/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Could not cancel the booking");
    setConfirming(false);
    router.refresh();
  }

  if (!confirming)
    return (
      <button type="button" className="btn btn-ghost px-0 text-sm underline decoration-rose underline-offset-4" onClick={() => setConfirming(true)}>
        Cancel this booking
      </button>
    );

  return (
    <div className="rounded-[var(--radius-md)] border hairline bg-blush/40 p-4" role="region" aria-label="Confirm cancellation">
      <p className="font-semibold">Cancel this booking?</p>
      <p className="mt-1 text-sm text-muted">
        {!paid ? "No payment has been made, so nothing will be charged." : refundPaise > 0 ? `Under the cancellation policy you will be refunded ${formatPaise(refundPaise)} to your original payment method.` : "Under the cancellation policy this cancellation is not eligible for a refund."}
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-primary min-h-[42px] bg-danger hover:bg-danger/90" onClick={cancel} disabled={busy}>
          {busy ? "Cancelling…" : "Yes, cancel booking"}
        </button>
        <button type="button" className="btn btn-secondary min-h-[42px]" onClick={() => setConfirming(false)}>
          Keep booking
        </button>
      </div>
      {error && <p className="field-error mt-2">{error}</p>}
    </div>
  );
}
