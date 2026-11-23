"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatPaise } from "@/lib/money";
import { payForBooking } from "@/lib/one-eighty/pay-booking";

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (ev: string, cb: (r: { error?: { description?: string } }) => void) => void };
  }
}

interface Order {
  provider: "razorpay" | "mock";
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  bookingCode: string;
  prefill: { name: string; contact: string; email?: string };
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the payment window. Check your connection and try again."));
    document.body.appendChild(s);
  });
}

export function PaymentPanel({ token, advancePaise, holdExpiresAt, supportWhatsapp }: { token: string; advancePaise: number; holdExpiresAt: string | null; supportWhatsapp: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "opening" | "verifying" | "failed" | "unavailable">("idle");
  const [message, setMessage] = useState("");
  const [mockOrder, setMockOrder] = useState<Order | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!holdExpiresAt) return;
    const end = new Date(holdExpiresAt).getTime();
    const tick = () => setRemaining(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt]);

  useEffect(() => {
    if (remaining === 0) router.refresh();
  }, [remaining, router]);

  async function verify(payload: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    setState("verifying");
    setMessage("Confirming your payment with the bank…");
    const res = await fetch("/api/payments/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingToken: token, ...payload }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("failed");
      setMessage(json.error ?? "We could not verify the payment. If money was deducted, it will be confirmed automatically or refunded.");
      return;
    }
    if (json.outcome === "failed") {
      setState("failed");
      setMessage("The payment did not go through. No money was taken. You can try again.");
      return;
    }
    if (json.outcome === "pending") {
      setMessage("Your payment is being processed by the bank. This page will update once it is confirmed.");
    }
    router.refresh();
  }

  async function pay() {
    setState("opening");
    setMessage("");
    try {
      const outcome = await payForBooking(token);
      if (outcome === "captured") return router.refresh();
      if (outcome === "cancelled") return setState("idle");
      if (outcome === "pending") {
        setState("idle");
        setMessage("Your payment is being confirmed. This page will update shortly.");
        return router.refresh();
      }
      if (outcome === "failed") {
        setState("failed");
        return setMessage("The payment did not go through. No money was taken. You can try again.");
      }
      // "manual" (mock / Razorpay) and "unavailable" continue below.
      const res = await fetch("/api/payments/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingToken: token }) });
      const json = await res.json();
      if (res.status === 503) {
        setState("unavailable");
        setMessage(json.error);
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "Could not start payment");
      const order = json as Order;
      if (order.provider === "mock") {
        setMockOrder(order);
        setState("idle");
        return;
      }
      await loadRazorpay();
      const rz = new window.Razorpay!({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: "VAISHORA",
        description: `Advance for booking ${order.bookingCode}`,
        prefill: order.prefill,
        theme: { color: "#4B1D3F" },
        handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => verify(r),
        modal: { ondismiss: () => setState((s) => (s === "opening" ? "idle" : s)) },
      });
      rz.on("payment.failed", (r) => {
        setState("failed");
        setMessage(r.error?.description ?? "The payment failed. No money was taken. You can try again.");
      });
      rz.open();
    } catch (e) {
      setState("failed");
      setMessage((e as Error).message);
    }
  }

  async function mockComplete(outcome: "success" | "failure") {
    if (!mockOrder) return;
    const res = await fetch("/api/payments/mock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: mockOrder.orderId, outcome }) });
    const json = await res.json();
    setMockOrder(null);
    if (!res.ok) {
      setState("failed");
      setMessage(json.error);
      return;
    }
    await verify(json);
  }

  const mm = remaining != null ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : null;

  return (
    <div className="card p-5">
      <h2 className="font-sans text-lg font-semibold text-plum-ink">Pay the advance to confirm</h2>
      <p className="mt-1 text-sm text-muted">
        Your slot is reserved{mm ? <> for <span className="font-semibold text-plum tabular-nums">{mm}</span></> : null}. Payments are processed securely by our payment partner; we never see or store card details.
      </p>
      <button type="button" className="btn btn-primary mt-4 w-full sm:w-auto" onClick={pay} disabled={state === "opening" || state === "verifying" || remaining === 0}>
        {state === "verifying" ? "Confirming…" : state === "opening" ? "Opening payment…" : state === "failed" ? `Try again — pay ${formatPaise(advancePaise)}` : `Pay ${formatPaise(advancePaise)}`}
      </button>
      {message && (
        <p className={`mt-3 text-sm ${state === "failed" || state === "unavailable" ? "text-danger" : "text-muted"}`} role="status">
          {message}
        </p>
      )}
      {state === "unavailable" && supportWhatsapp && (
        <a className="btn btn-secondary mt-3" href={`https://wa.me/${supportWhatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener">
          Message us on WhatsApp
        </a>
      )}

      {mockOrder && (
        <div className="mt-4 rounded-[var(--radius-md)] border-2 border-dashed border-gold p-4" role="dialog" aria-label="Test payment">
          <p className="text-sm font-semibold">Test payment gateway (development only)</p>
          <p className="mt-1 text-xs text-muted">No real money moves. This panel cannot appear in production. The result still goes through server-side signature verification.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary min-h-[42px]" onClick={() => mockComplete("success")}>
              Simulate successful payment
            </button>
            <button type="button" className="btn btn-secondary min-h-[42px]" onClick={() => mockComplete("failure")}>
              Simulate failed payment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
