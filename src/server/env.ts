import "server-only";

const DEV_SECRET = "vaishora-dev-only-secret-change-me-0000000000";

export function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("APP_SECRET (32+ chars) must be set in production");
  return DEV_SECRET;
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export type PaymentProviderName = "razorpay" | "mock" | "180pay" | "none";

export function paymentProviderName(): PaymentProviderName {
  const p = process.env.PAYMENT_PROVIDER;
  if (p === "180pay") return process.env.ONE_EIGHTY_CLIENT_ID || process.env.NEXT_PUBLIC_CORE_CLIENT_ID ? "180pay" : "none";
  if (p === "razorpay") return process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? "razorpay" : "none";
  // The mock gateway exists for local end-to-end testing only and can never run in production.
  if (p === "mock" && process.env.NODE_ENV !== "production") return "mock";
  return "none";
}
