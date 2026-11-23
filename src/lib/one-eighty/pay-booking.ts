"use client";

import { payWith180 } from "./client";

export type PayOutcome = "captured" | "pending" | "failed" | "cancelled" | "unavailable" | "manual";

/**
 * Creates (or reuses) the payment order for a booking and opens the provider's checkout.
 * 180 Pay opens its own bottom sheet; the mock provider (dev only) is handled on the booking page.
 * The result is always confirmed server-side before the booking changes state.
 */
export async function payForBooking(bookingToken: string): Promise<PayOutcome> {
  const res = await fetch("/api/payments/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingToken }) });
  const order = await res.json().catch(() => ({}));
  if (res.status === 503) return "unavailable";
  if (!res.ok) throw new Error(order.error ?? "Could not start payment");
  if (order.provider !== "180pay") return "manual"; // mock / Razorpay handled by PaymentPanel

  const result = await payWith180({
    amount: order.amount / 100,
    currency: order.currency,
    title: order.title,
    description: order.description,
    orderId: order.orderId,
    customer: { name: order.prefill?.name, email: order.prefill?.email, phone: order.prefill?.contact },
    environment: order.environment,
  });
  if (!result) return "cancelled";
  const v = await fetch("/api/payments/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingToken, provider: "180pay", orderId: order.orderId, sessionId: result.sessionId, transactionId: result.transactionId }),
  });
  const vj = await v.json().catch(() => ({}));
  if (!v.ok) throw new Error(vj.error ?? "We could not confirm the payment yet. If money was deducted, it will be confirmed automatically.");
  return vj.outcome as PayOutcome;
}
