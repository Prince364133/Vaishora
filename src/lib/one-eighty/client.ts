"use client";

// Browser wrappers for the 180 Core SDK (180 Identity + 180 Pay). The SDK renders its own
// bottom sheets / popups — we never build login or checkout screens. Everything returned here is
// untrusted until the server verifies it (see src/server/one-eighty.ts).
// Spec: docs/integrations/180CORE.md

const SDK_URL = "https://profile.180core.cloud/sdk/v1/180-core-sdk.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = Record<string, any>;

declare global {
  interface Window {
    __180_CLIENT_ID?: string;
    OneEighty?: AnyObj;
    OneEightyIdentity?: AnyObj;
    OneEightyAuth?: AnyObj;
    OneEightyPay?: AnyObj;
  }
}

export const CLIENT_ID = process.env.NEXT_PUBLIC_CORE_CLIENT_ID ?? "";

let loading: Promise<void> | null = null;

export function load180Sdk(timeoutMs = 8000): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("180 SDK needs a browser"));
  window.__180_CLIENT_ID = CLIENT_ID;
  if (window.OneEightyIdentity || window.OneEightyPay || window.OneEighty) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("Could not load secure sign-in. Check your connection and try again."));
    };
    document.head.appendChild(s);
    const until = Date.now() + timeoutMs;
    const poll = () => {
      if (window.OneEightyIdentity || window.OneEightyAuth || window.OneEightyPay || window.OneEighty) return resolve();
      if (Date.now() > until) {
        loading = null;
        return reject(new Error("Secure sign-in took too long to load. Please try again."));
      }
      setTimeout(poll, 60);
    };
    poll();
  });
  return loading;
}

function identityApi(): AnyObj {
  const api = window.OneEightyIdentity ?? window.OneEightyAuth ?? window.OneEighty?.auth ?? window.OneEighty?.identity;
  if (!api || (!api.openAuth && !api.signIn && !api.openBottomSheet)) {
    throw new Error("Secure sign-in is unavailable right now.");
  }
  return api;
}

function payApi(): AnyObj {
  const api = window.OneEightyPay ?? window.OneEighty?.pay;
  if (!api || (!api.checkout && !api.openBottomSheet)) {
    throw new Error("Secure payment is unavailable right now.");
  }
  return api;
}

/** Raw result of the 180 Identity sheet, forwarded to /api/auth/180 for verification. */
export type IdentityResult = AnyObj;

/** Opens the 180 Identity bottom sheet. Resolves null if the user closes it. */
export async function signInWith180(): Promise<IdentityResult | null> {
  await load180Sdk();
  const api = identityApi();
  const fn = api.openBottomSheet ?? api.signIn ?? api.openAuth;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (v: IdentityResult | null, err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err instanceof Error ? err : new Error(String((err as AnyObj)?.message ?? err)));
      else resolve(v);
    };
    Promise.resolve(
      fn.call(api, {
        clientId: CLIENT_ID,
        redirectUri: `${window.location.origin}/oauth/callback`,
        scope: "openid identity:read identity:email identity:phone",
        state: crypto.getRandomValues(new Uint32Array(2)).join("-"),
        environment: "production",
        uxMode: "bottom_sheet",
        onSuccess: (r: IdentityResult) => done(mapAuth(r)),
        onError: (e: unknown) => done(null, e),
        onCancel: () => done(null),
      }),
    )
      .then((r: IdentityResult | null) => done(mapAuth(r)))
      .catch((e: unknown) => done(null, e));
  });
}

// Only the authorization code / ID token go to our server; the sheet's `user` object and
// general session token are never trusted.
function mapAuth(r: IdentityResult | null): IdentityResult | null {
  if (!r || !(r.code || r.id_token || r.idToken)) return null;
  return { code: r.code, idToken: r.idToken ?? r.id_token, redirectUri: `${window.location.origin}/oauth/callback` };
}

export interface PayRequest {
  amount: number; // rupees
  currency: string;
  title: string;
  description?: string;
  orderId: string;
  customer?: { name?: string; email?: string; phone?: string };
  environment?: string;
}

export interface PayResult {
  sessionId?: string;
  transactionId?: string;
  amount?: number;
  currency?: string;
}

/** Opens the 180 Pay bottom sheet. Resolves null when the customer cancels. */
export async function payWith180(req: PayRequest): Promise<PayResult | null> {
  await load180Sdk();
  const api = payApi();
  const fn = api.openBottomSheet ?? api.checkout;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (v: PayResult | null, err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err instanceof Error ? err : new Error(String((err as AnyObj)?.message ?? err)));
      else resolve(v);
    };
    Promise.resolve(
      fn.call(api, {
        clientId: CLIENT_ID,
        ...req,
        customerEmail: req.customer?.email,
        customerPhone: req.customer?.phone,
        environment: "production",
        uxMode: "bottom_sheet",
        onSuccess: (r: PayResult) => done(r),
        onError: (e: unknown) => done(null, e),
        onCancel: () => done(null),
      }),
    )
      .then((r: PayResult | null) => done(r && (r.transactionId || r.sessionId) ? r : null))
      .catch((e: unknown) => done(null, e));
  });
}
