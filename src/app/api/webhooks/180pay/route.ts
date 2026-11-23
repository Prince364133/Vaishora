import { getDb } from "@/server/db";
import { verify180Webhook } from "@/server/one-eighty";
import { verify180Payment } from "@/server/payments/service";
import { bookingAccessToken } from "@/server/bookings";
import { fail, ok } from "@/server/http";

// 180 Pay webhook. Register https://<domain>/api/webhooks/180pay in the 180 developer portal
// (project -> 180 Pay -> Overview & Webhook) and set ONE_EIGHTY_WEBHOOK_SECRET.
// The payload shape is not fully documented, so the webhook is only a trigger: the payment is
// always re-verified against the 180 session API before a booking changes.
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return fail("Payload too large", 413);
  if (!verify180Webhook(raw, req.headers.get("x-180-signature") ?? "", req.headers.get("x-180-timestamp"))) return fail("Invalid signature", 401);
  let event: { id?: string; event?: string; type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return fail("Invalid JSON", 400);
  }
  const type = event.event ?? event.type ?? "unknown";
  const id = event.id ?? `180:${type}:${Date.now()}`;
  const db = await getDb();
  const inserted = await db.query(`INSERT INTO payment_events(id, provider, event_type, payload) VALUES ($1, '180pay', $2, $3::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id`, [id, type, raw]);
  if (!inserted.length) return ok({ received: true, duplicate: true });

  const d = (event.data ?? {}) as Record<string, unknown>;
  const sessionId = String(d.sessionId ?? d.session_id ?? "");
  const orderId = String(d.orderId ?? d.order_id ?? (d.metadata as Record<string, unknown> | undefined)?.orderId ?? "");
  if (/captured|completed|success/i.test(type) && sessionId && orderId) {
    const row = await db.query<{ booking_id: string }>(`SELECT booking_id FROM payments WHERE provider = '180pay' AND provider_order_id = $1`, [orderId]);
    if (row[0]) {
      try {
        await verify180Payment({ bookingToken: bookingAccessToken(row[0].booking_id), orderId, sessionId });
      } catch (e) {
        console.error("[180pay webhook]", e);
      }
    }
  }
  await db.query(`UPDATE payment_events SET processed_at = now() WHERE id = $1`, [id]);
  return ok({ received: true });
}
