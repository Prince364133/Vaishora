import "server-only";
import crypto from "node:crypto";
import { safeEqual } from "./crypto";

// Server-side 180 Core verification. Never trust anything the browser sheet returns until it is
// verified here. Contract: docs/integrations/180CORE.md (extracted 2026-11-23; several fields are
// marked unconfirmed there — re-check when 180 enables login/pay for the app).

const API = "https://api.180core.cloud";
const ISSUER = "https://profile.180core.cloud";
const JWKS_URL = `${API}/certs/jwks.json`;

export const ONE_EIGHTY_CLIENT_ID = process.env.ONE_EIGHTY_CLIENT_ID || process.env.NEXT_PUBLIC_CORE_CLIENT_ID || "";

export class OneEightyError extends Error {
  constructor(message: string, public status = 401) {
    super(message);
  }
}

export function oneEightyIdentityEnabled() {
  return process.env.ONE_EIGHTY_IDENTITY !== "off" && !!ONE_EIGHTY_CLIENT_ID;
}

// ------------------------------------------------------------------ identity

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}
let jwksCache: { at: number; keys: Jwk[] } | null = null;

async function jwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const res = await fetch(JWKS_URL, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new OneEightyError("Could not reach the sign-in service", 502);
  const j = (await res.json()) as { keys: Jwk[] };
  jwksCache = { at: Date.now(), keys: j.keys ?? [] };
  return jwksCache.keys;
}

const b64url = (s: string) => Buffer.from(s, "base64url");

/** Verifies an RS256 ID token from 180 Identity (signature, issuer, audience, expiry). */
export async function verifyIdToken(token: string): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new OneEightyError("Malformed sign-in token");
  const header = JSON.parse(b64url(parts[0]).toString("utf8")) as { alg: string; kid?: string };
  if (header.alg !== "RS256") throw new OneEightyError("Unexpected token algorithm");
  const keys = await jwks();
  const jwk = keys.find((k) => k.kid === header.kid) ?? (keys.length === 1 ? keys[0] : undefined);
  if (!jwk) throw new OneEightyError("Unknown signing key");
  const key = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" });
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, b64url(parts[2]));
  if (!ok) throw new OneEightyError("Sign-in token signature is invalid");
  const claims = JSON.parse(b64url(parts[1]).toString("utf8")) as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER) throw new OneEightyError("Sign-in token issuer mismatch");
  const aud = claims.aud;
  if (!(aud === ONE_EIGHTY_CLIENT_ID || (Array.isArray(aud) && aud.includes(ONE_EIGHTY_CLIENT_ID)))) throw new OneEightyError("Sign-in token was not issued for VAISHORA");
  if (typeof claims.exp !== "number" || claims.exp < now - 30) throw new OneEightyError("Sign-in expired, please try again");
  if (typeof claims.sub !== "string" || !claims.sub) throw new OneEightyError("Sign-in token has no subject");
  return claims;
}

export interface VerifiedIdentity {
  sub: string;
  email: string | null;
  name: string | null;
  phone: string | null;
}

function pick(c: Record<string, unknown>): VerifiedIdentity {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    sub: String(c.sub ?? c.id ?? ""),
    email: str(c.email)?.toLowerCase() ?? null,
    name: str(c.name) ?? ([str(c.given_name), str(c.family_name)].filter(Boolean).join(" ") || null),
    phone: str(c.phone_number) ?? str(c.phone),
  };
}

/**
 * Turns the browser result of the 180 Identity sheet into a verified identity.
 * Preferred: exchange the authorization code with our client secret (server-to-server).
 * Fallback: a signed ID token bound to our client id. The sheet's `user` object and its general
 * session `token` are never trusted.
 */
export async function verifyIdentityResult(input: { code?: string; idToken?: string; redirectUri?: string; codeVerifier?: string }): Promise<VerifiedIdentity> {
  const secret = process.env.ONE_EIGHTY_CLIENT_SECRET;
  if (input.code && secret) {
    const res = await fetch(`${API}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: ONE_EIGHTY_CLIENT_ID,
        client_secret: secret,
        code: input.code,
        redirect_uri: input.redirectUri,
        ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const tok = (await res.json().catch(() => ({}))) as { id_token?: string; access_token?: string; error?: string; error_description?: string };
    if (res.ok) {
      if (tok.id_token) return pick(await verifyIdToken(tok.id_token));
      if (tok.access_token) {
        const ui = await fetch(`${API}/api/oauth/userinfo`, { headers: { Authorization: `Bearer ${tok.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (ui.ok) {
          const info = pick((await ui.json()) as Record<string, unknown>);
          if (info.sub) return info;
        }
      }
    }
    if (!input.idToken) throw new OneEightyError(tok.error_description || tok.error || "Sign-in could not be verified");
  }
  if (input.idToken) return pick(await verifyIdToken(input.idToken));
  throw new OneEightyError("Sign-in could not be verified");
}

// ------------------------------------------------------------------ pay

export interface VerifiedPaySession {
  sessionId: string;
  transactionId: string | null;
  amountRupees: number;
  currency: string;
  paid: boolean;
  raw: unknown;
}

/** Looks up a 180 Pay checkout session and checks it belongs to us and is genuinely paid. */
export async function fetchPaySession(sessionId: string): Promise<VerifiedPaySession> {
  if (!/^sess_[A-Za-z0-9_-]{6,120}$/.test(sessionId)) throw new OneEightyError("Invalid payment session", 400);
  if (process.env.NODE_ENV === "production" && sessionId.startsWith("sess_sandbox")) throw new OneEightyError("Sandbox payments are not accepted", 400);
  const res = await fetch(`${API}/api/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const j = (await res.json().catch(() => ({}))) as { session?: Record<string, unknown> & { app?: { clientId?: string } } };
  const s = j.session;
  if (!res.ok || !s) throw new OneEightyError("Payment session not found", 404);
  if ((s.metadata as { autoCreated?: boolean } | undefined)?.autoCreated && s.status === "PENDING") throw new OneEightyError("Payment session not found", 404);
  if (s.app?.clientId !== ONE_EIGHTY_CLIENT_ID) throw new OneEightyError("Payment does not belong to VAISHORA", 400);
  const status = String(s.status ?? "");
  return {
    sessionId,
    transactionId: typeof s.transactionId === "string" ? s.transactionId : null,
    amountRupees: Number(s.amount),
    currency: String(s.currency ?? ""),
    paid: ["CAPTURED", "COMPLETED"].includes(status),
    raw: s,
  };
}

/** Verifies an `x-180-signature` webhook (HMAC-SHA256 hex over `${ts}.${body}` or the raw body). */
export function verify180Webhook(rawBody: string, signatureHeader: string, timestampHeader: string | null): boolean {
  const secret = process.env.ONE_EIGHTY_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  let sig = signatureHeader.trim();
  let ts = timestampHeader;
  const m = /t=(\d+),\s*v1=([0-9a-f]+)/i.exec(sig);
  if (m) {
    ts = m[1];
    sig = m[2];
  }
  if (ts) {
    let t = Number(ts);
    if (t > 1e12) t = Math.floor(t / 1000);
    if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
    const mac = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
    if (safeEqual(mac, sig)) return true;
  }
  return safeEqual(crypto.createHmac("sha256", secret).update(rawBody).digest("hex"), sig);
}
