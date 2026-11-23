import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { verify180Webhook } from "@/server/one-eighty";

const SECRET = "whsec_test_secret";
const body = JSON.stringify({ event: "payment.captured", id: "evt_1", data: { sessionId: "sess_abc123", orderId: "vsh_X_1" } });
const hmac = (m: string) => crypto.createHmac("sha256", SECRET).update(m).digest("hex");

describe("180 Pay webhook signature", () => {
  afterEach(() => {
    delete process.env.ONE_EIGHTY_WEBHOOK_SECRET;
  });
  it("accepts raw-body and timestamped signatures", () => {
    process.env.ONE_EIGHTY_WEBHOOK_SECRET = SECRET;
    expect(verify180Webhook(body, hmac(body), null)).toBe(true);
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verify180Webhook(body, hmac(`${ts}.${body}`), ts)).toBe(true);
    expect(verify180Webhook(body, `t=${ts},v1=${hmac(`${ts}.${body}`)}`, null)).toBe(true);
  });
  it("rejects tampered bodies, stale timestamps and missing secrets", () => {
    process.env.ONE_EIGHTY_WEBHOOK_SECRET = SECRET;
    expect(verify180Webhook(body + " ", hmac(body), null)).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(verify180Webhook(body, hmac(`${old}.${body}`), old)).toBe(false);
    delete process.env.ONE_EIGHTY_WEBHOOK_SECRET;
    expect(verify180Webhook(body, hmac(body), null)).toBe(false);
  });
});
