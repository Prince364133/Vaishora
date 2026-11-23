import "server-only";
import crypto from "node:crypto";
import { hmacSha256Hex, safeEqual } from "../crypto";
import { paymentProviderName } from "../env";

export interface ProviderPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  method?: string;
  error_description?: string | null;
}

export interface PaymentProvider {
  name: "razorpay" | "mock";
  keyId: string;
  createOrder(amountPaise: number, receipt: string, notes: Record<string, string>): Promise<{ id: string; raw: unknown }>;
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
  fetchPayment(paymentId: string): Promise<ProviderPayment>;
  capture(paymentId: string, amountPaise: number): Promise<ProviderPayment>;
  refund(paymentId: string, amountPaise: number, notes: Record<string, string>): Promise<{ id: string; status: "pending" | "processed" | "failed"; raw: unknown }>;
  verifyWebhook(rawBody: string, signature: string): boolean;
}

export class PaymentProviderError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

// ------------------------------------------------------------------ Razorpay
// Docs: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/
// Orders are created server-side; the checkout signature is HMAC-SHA256("order_id|payment_id")
// with the key secret; webhooks are HMAC-SHA256(raw body) with the separate webhook secret.

function razorpay(): PaymentProvider {
  const keyId = process.env.RAZORPAY_KEY_ID!;
  const secret = process.env.RAZORPAY_KEY_SECRET!;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  const auth = "Basic " + Buffer.from(`${keyId}:${secret}`).toString("base64");

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
    if (!res.ok) throw new PaymentProviderError(json.error?.description ?? `Razorpay request failed (${res.status})`);
    return json as T;
  }

  return {
    name: "razorpay",
    keyId,
    async createOrder(amount, receipt, notes) {
      const raw = await call<{ id: string }>("POST", "/orders", { amount, currency: "INR", receipt, notes });
      return { id: raw.id, raw };
    },
    verifyCheckoutSignature(orderId, paymentId, signature) {
      return safeEqual(hmacSha256Hex(secret, `${orderId}|${paymentId}`), signature);
    },
    fetchPayment(paymentId) {
      return call<ProviderPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`);
    },
    capture(paymentId, amount) {
      return call<ProviderPayment>("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, { amount, currency: "INR" });
    },
    async refund(paymentId, amount, notes) {
      const raw = await call<{ id: string; status: string }>("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, { amount, notes, speed: "normal" });
      const status = raw.status === "processed" ? "processed" : raw.status === "failed" ? "failed" : "pending";
      return { id: raw.id, status, raw };
    },
    verifyWebhook(rawBody, signature) {
      if (!webhookSecret || !signature) return false;
      return safeEqual(hmacSha256Hex(webhookSecret, rawBody), signature);
    },
  };
}

// ------------------------------------------------------------------ Mock (local development only)
// Simulates a gateway so the full booking → payment → confirmation path can be tested without
// credentials. It is impossible to enable in production (see env.paymentProviderName), and it
// still goes through the same server-side signature verification code path.

const MOCK_SECRET = "vaishora-mock-gateway-secret";
const mockPayments = ((globalThis as unknown as { __mockPayments?: Map<string, ProviderPayment> }).__mockPayments ??= new Map());

function mock(): PaymentProvider {
  if (process.env.NODE_ENV === "production") throw new Error("Mock payment provider is disabled in production");
  return {
    name: "mock",
    keyId: "mock_key",
    async createOrder(amount) {
      return { id: `order_mock_${crypto.randomBytes(8).toString("hex")}`, raw: { amount, mock: true } };
    },
    verifyCheckoutSignature(orderId, paymentId, signature) {
      return safeEqual(hmacSha256Hex(MOCK_SECRET, `${orderId}|${paymentId}`), signature);
    },
    async fetchPayment(paymentId) {
      const p = mockPayments.get(paymentId);
      if (!p) throw new PaymentProviderError("Unknown mock payment", 404);
      return p;
    },
    async capture(paymentId) {
      const p = mockPayments.get(paymentId);
      if (!p) throw new PaymentProviderError("Unknown mock payment", 404);
      p.status = "captured";
      return p;
    },
    async refund(paymentId) {
      return { id: `rfnd_mock_${crypto.randomBytes(6).toString("hex")}`, status: "processed", raw: { paymentId } };
    },
    verifyWebhook() {
      return false;
    },
  };
}

/** Called by the mock checkout UI (dev only) to simulate the customer completing or failing payment. */
export function mockCompletePayment(orderId: string, amount: number, outcome: "success" | "failure") {
  if (paymentProviderName() !== "mock") throw new PaymentProviderError("Mock gateway is not enabled", 404);
  const id = `pay_mock_${crypto.randomBytes(8).toString("hex")}`;
  mockPayments.set(id, {
    id,
    order_id: orderId,
    amount,
    currency: "INR",
    status: outcome === "success" ? "captured" : "failed",
    method: "mock",
    error_description: outcome === "failure" ? "Payment declined (simulated)" : null,
  });
  return { razorpay_order_id: orderId, razorpay_payment_id: id, razorpay_signature: hmacSha256Hex(MOCK_SECRET, `${orderId}|${id}`) };
}

export function getPaymentProvider(): PaymentProvider | null {
  const name = paymentProviderName();
  if (name === "razorpay") return razorpay();
  if (name === "mock") return mock();
  return null;
}
