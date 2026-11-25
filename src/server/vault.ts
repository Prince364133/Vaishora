import "server-only";
import crypto from "node:crypto";
import { appSecret } from "./env";

// Field-level encryption for sensitive values (bank account numbers). AES-256-GCM with a key
// derived from APP_SECRET; output is "v1.<iv>.<tag>.<ciphertext>" (base64url).

const key = () => crypto.createHash("sha256").update(`vaishora:vault:v1:${appSecret()}`).digest();

export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptField(token: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unreadable encrypted value");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

export const maskAccount = (last4: string) => `•••• ${last4}`;
