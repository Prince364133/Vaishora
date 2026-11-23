import "server-only";
import { getDb, Queryable } from "../db";
import { BookingError, getBookingByToken, recordStatus, transitionBooking } from "../bookings";
import { getPaymentProvider, PaymentProviderError, ProviderPayment } from "./provider";
import { paymentProviderName } from "../env";
import { fetchPaySession } from "../one-eighty";
import crypto from "node:crypto";
import type { BookingStatus } from "@/lib/booking-status";

export async function createPaymentOrder(token: string) {
  if (paymentProviderName() === "180pay") return create180PayOrder(token);
  const provider = getPaymentProvider();
  if (!provider) throw new PaymentProviderError("Online payment is not configured yet. Please contact us on WhatsApp to complete your booking.", 503);
  const db = await getDb();
  const booking = await getBookingByToken(token, db);
  if (!booking) throw new BookingError("Booking not found", "not_found", 404);
  if (booking.status !== "pending_payment") throw new BookingError("This booking does not need a payment.", "invalid", 409);
  if (booking.hold_expires_at && new Date(booking.hold_expires_at) < new Date())
    throw new BookingError("The payment window for this booking has closed. Please book the slot again.", "invalid", 409);

  // Reuse an open order for the same amount so retries don't create duplicate orders.
  const open = await db.query<{ provider_order_id: string }>(
    `SELECT provider_order_id FROM payments WHERE booking_id = $1 AND provider = $2 AND status IN ('created', 'attempted', 'failed') AND amount_paise = $3
     ORDER BY created_at DESC LIMIT 1`,
    [booking.id, provider.name, booking.advance_paise],
  );
  let orderId = open[0]?.provider_order_id;
  if (!orderId) {
    const order = await provider.createOrder(booking.advance_paise, booking.code, { booking_code: booking.code, booking_id: booking.id });
    orderId = order.id;
    await db.query(
      `INSERT INTO payments(booking_id, provider, provider_order_id, amount_paise, status, raw) VALUES ($1, $2, $3, $4, 'created', $5::jsonb)`,
      [booking.id, provider.name, orderId, booking.advance_paise, JSON.stringify(order.raw)],
    );
  }
  return {
    provider: provider.name,
    keyId: provider.keyId,
    orderId,
    amount: booking.advance_paise,
    currency: "INR",
    bookingCode: booking.code,
    prefill: { name: booking.customer_name, contact: booking.customer_phone, email: booking.customer_email ?? undefined },
  };
}

/**
 * Apply a provider-confirmed payment to its booking. Idempotent: safe to call from the
 * checkout callback and from webhooks, in any order, any number of times.
 */
export async function applyPayment(q: Queryable, p: ProviderPayment, actor: "system" | "webhook") {
  const rows = await q.query<{ id: string; booking_id: string; amount_paise: number; status: string }>(
    `SELECT id, booking_id, amount_paise, status FROM payments WHERE provider_order_id = $1 FOR UPDATE`,
    [p.order_id],
  );
  const pay = rows[0];
  if (!pay) throw new BookingError("Unknown payment order", "not_found", 404);

  if (p.status === "failed") {
    if (pay.status !== "captured") {
      await q.query(`UPDATE payments SET status = 'failed', provider_payment_id = COALESCE(provider_payment_id, $2), failure_reason = $3, updated_at = now() WHERE id = $1`, [
        pay.id,
        p.id,
        p.error_description ?? "Payment failed",
      ]);
    }
    return { outcome: "failed" as const, bookingId: pay.booking_id };
  }
  if (p.status !== "captured") return { outcome: "pending" as const, bookingId: pay.booking_id };
  if (p.amount !== pay.amount_paise || p.currency !== "INR") {
    await q.query(`UPDATE payments SET failure_reason = 'amount_mismatch', raw = $2::jsonb, updated_at = now() WHERE id = $1`, [pay.id, JSON.stringify(p)]);
    throw new BookingError("Payment amount does not match the booking. Our team has been alerted.", "invalid", 409);
  }
  if (pay.status === "captured") return { outcome: "captured" as const, bookingId: pay.booking_id };

  await q.query(`UPDATE payments SET status = 'captured', provider_payment_id = $2, raw = $3::jsonb, failure_reason = NULL, updated_at = now() WHERE id = $1`, [
    pay.id,
    p.id,
    JSON.stringify(p),
  ]);

  const b = (await q.query<{ id: string; status: BookingStatus; artist_id: string | null; coupon_id: string | null }>(
    `SELECT id, status, artist_id, coupon_id FROM bookings WHERE id = $1 FOR UPDATE`,
    [pay.booking_id],
  ))[0];

  if (b.status === "pending_payment" || b.status === "expired") {
    const revived = b.status === "expired";
    let artistId = b.artist_id;
    if (revived && artistId) {
      // The slot was released when the hold expired; keep the artist only if nobody else took it.
      await q.query(`SAVEPOINT revive`);
      try {
        await transitionBooking(q, b.id, "paid", { type: actor }, "Payment confirmed after the hold expired");
        await q.query(`RELEASE SAVEPOINT revive`);
      } catch (e) {
        if ((e as { code?: string }).code !== "23P01") throw e;
        await q.query(`ROLLBACK TO SAVEPOINT revive`);
        await q.query(`UPDATE bookings SET artist_id = NULL WHERE id = $1`, [b.id]);
        artistId = null;
        await transitionBooking(q, b.id, "paid", { type: actor }, "Payment confirmed after the hold expired; original slot was taken");
      }
    } else {
      await transitionBooking(q, b.id, "paid", { type: actor }, revived ? "Payment confirmed after the hold expired" : "Advance payment verified");
    }
    if (b.coupon_id) await q.query(`UPDATE coupons SET used_count = used_count + 1 WHERE id = $1`, [b.coupon_id]);
    await transitionBooking(
      q,
      b.id,
      artistId ? "awaiting_artist_confirmation" : "awaiting_artist_assignment",
      { type: "system" },
      artistId ? "Artist requested; waiting for their confirmation" : "Needs manual artist assignment",
    );
    await queueNotifications(q, b.id);
  } else {
    // Captured payment for a booking that is already cancelled/refunded etc. — flag for the team.
    await recordStatus(q, b.id, b.status, b.status, { type: actor }, `Payment ${p.id} captured while booking was ${b.status}; review required`);
  }
  return { outcome: "captured" as const, bookingId: b.id };
}

async function queueNotifications(q: Queryable, bookingId: string) {
  const rows = await q.query<{ phone: string; code: string }>(
    `SELECT c.phone, b.code FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE b.id = $1`,
    [bookingId],
  );
  if (!rows[0]) return;
  // Delivery requires a WhatsApp Business / SMS provider (see docs/IMPLEMENTATION_STATUS.md).
  await q.query(
    `INSERT INTO notifications(booking_id, channel, template, recipient, payload) VALUES ($1, 'whatsapp', 'booking_paid', $2, $3::jsonb)`,
    [bookingId, rows[0].phone, JSON.stringify({ code: rows[0].code })],
  );
}

/** Checkout callback: verify signature, then confirm with the provider before trusting anything. */
export async function verifyCheckout(input: { bookingToken: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
  const provider = getPaymentProvider();
  if (!provider) throw new PaymentProviderError("Payment gateway not configured", 503);
  const db = await getDb();
  const booking = await getBookingByToken(input.bookingToken, db);
  if (!booking) throw new BookingError("Booking not found", "not_found", 404);
  const own = await db.query(`SELECT 1 FROM payments WHERE booking_id = $1 AND provider_order_id = $2`, [booking.id, input.razorpay_order_id]);
  if (!own.length) throw new BookingError("Payment does not belong to this booking", "invalid", 400);
  if (!provider.verifyCheckoutSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature)) {
    throw new BookingError("Payment signature could not be verified.", "invalid", 400);
  }
  let payment = await provider.fetchPayment(input.razorpay_payment_id);
  if (payment.order_id !== input.razorpay_order_id) throw new BookingError("Payment does not match the order.", "invalid", 400);
  if (payment.status === "authorized") payment = await provider.capture(payment.id, payment.amount);
  const result = await db.tx((q) => applyPayment(q, payment, "system"));
  return result;
}

export async function handleRazorpayWebhook(rawBody: string, signature: string, eventId: string | null) {
  const provider = getPaymentProvider();
  if (!provider || provider.name !== "razorpay") throw new PaymentProviderError("Razorpay is not configured", 503);
  if (!provider.verifyWebhook(rawBody, signature)) throw new PaymentProviderError("Invalid webhook signature", 401);
  const event = JSON.parse(rawBody) as {
    event: string;
    payload: { payment?: { entity: ProviderPayment }; refund?: { entity: { id: string; status: string; payment_id: string } } };
  };
  const db = await getDb();
  const id = eventId ?? `${event.event}:${event.payload.payment?.entity.id ?? event.payload.refund?.entity.id ?? Date.now()}`;
  return db.tx(async (q) => {
    const inserted = await q.query(
      `INSERT INTO payment_events(id, provider, event_type, payload) VALUES ($1, 'razorpay', $2, $3::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id, event.event, rawBody],
    );
    if (!inserted.length) {
      const prev = await q.query<{ processed_at: string | null }>(`SELECT processed_at FROM payment_events WHERE id = $1`, [id]);
      if (prev[0]?.processed_at) return { duplicate: true };
    }
    switch (event.event) {
      case "payment.captured":
      case "payment.failed":
      case "order.paid":
        if (event.payload.payment) await applyPayment(q, event.payload.payment.entity, "webhook");
        break;
      case "refund.processed":
      case "refund.failed":
        if (event.payload.refund) await applyRefundUpdate(q, event.payload.refund.entity.id, event.event === "refund.processed" ? "processed" : "failed");
        break;
      default:
        break;
    }
    await q.query(`UPDATE payment_events SET processed_at = now() WHERE id = $1`, [id]);
    return { duplicate: false };
  });
}

async function applyRefundUpdate(q: Queryable, providerRefundId: string, status: "processed" | "failed") {
  const rows = await q.query<{ id: string; booking_id: string; payment_id: string }>(
    `UPDATE refunds SET status = $2, updated_at = now() WHERE provider_refund_id = $1 RETURNING id, booking_id, payment_id`,
    [providerRefundId, status],
  );
  const r = rows[0];
  if (!r || status !== "processed") return;
  await settleRefundedBooking(q, r.booking_id, r.payment_id);
}

async function settleRefundedBooking(q: Queryable, bookingId: string, paymentId: string) {
  const pending = await q.query(`SELECT 1 FROM refunds WHERE booking_id = $1 AND status = 'pending'`, [bookingId]);
  if (pending.length) return;
  const sums = await q.query<{ paid: number; refunded: number }>(
    `SELECT (SELECT amount_paise FROM payments WHERE id = $1::uuid) AS paid,
            COALESCE((SELECT sum(amount_paise) FROM refunds WHERE payment_id = $1::uuid AND status = 'processed'), 0)::int AS refunded`,
    [paymentId],
  );
  const full = sums[0].refunded >= sums[0].paid;
  await q.query(`UPDATE payments SET status = $2, updated_at = now() WHERE id = $1`, [paymentId, full ? "refunded" : "partially_refunded"]);
  const b = await q.query<{ status: BookingStatus }>(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
  if (b[0]?.status === "refund_pending") await transitionBooking(q, bookingId, "refunded", { type: "webhook" }, "Refund processed by gateway");
}

/**
 * Cancel a paid booking and refund `amount` (may be 0 when the policy gives no refund).
 * The refund is recorded (status pending) and committed BEFORE the gateway is called, so a
 * gateway refund can never exist without a matching row; the result is applied afterwards
 * (and again by the refund.processed / refund.failed webhooks).
 */
export async function cancelWithRefund(
  bookingId: string,
  amountPaise: number,
  actor: { type: "customer" | "admin"; id?: string | null },
  reason: string,
) {
  const db = await getDb();
  const provider = getPaymentProvider();
  const prepared = await db.tx(async (q) => {
    const b = (await q.query<{ status: BookingStatus }>(`SELECT status FROM bookings WHERE id = $1 FOR UPDATE`, [bookingId]))[0];
    if (!b) throw new BookingError("Booking not found", "not_found", 404);
    const pay = (await q.query<{ id: string; provider: string; provider_payment_id: string; amount_paise: number }>(
      `SELECT id, provider, provider_payment_id, amount_paise FROM payments WHERE booking_id = $1 AND status IN ('captured', 'partially_refunded') ORDER BY created_at DESC LIMIT 1`,
      [bookingId],
    ))[0];

    if (b.status === "pending_payment") {
      await transitionBooking(q, bookingId, "cancelled", actor, reason);
      return null;
    }
    if (!pay || amountPaise <= 0) {
      if (b.status !== "cancelled") await transitionBooking(q, bookingId, "cancelled", actor, `${reason} (no refund due under policy)`);
      return null;
    }
    if (!provider || provider.name !== pay.provider) throw new PaymentProviderError("Payment gateway is not configured for refunds", 503);
    const already = await q.query<{ s: number }>(`SELECT COALESCE(sum(amount_paise), 0)::int AS s FROM refunds WHERE payment_id = $1 AND status <> 'failed'`, [pay.id]);
    const amount = Math.min(amountPaise, pay.amount_paise - already[0].s);
    if (amount <= 0) throw new BookingError("Nothing left to refund on this payment.");
    if (b.status !== "refund_pending") await transitionBooking(q, bookingId, "refund_pending", actor, reason);
    const r = await q.query<{ id: string }>(
      `INSERT INTO refunds(payment_id, booking_id, amount_paise, status, reason, created_by) VALUES ($1, $2, $3, 'pending', $4, $5) RETURNING id`,
      [pay.id, bookingId, amount, reason, actor.type === "admin" ? actor.id ?? null : null],
    );
    return { refundId: r[0].id, pay, amount };
  });
  if (!prepared) return { refunded: 0 };

  const { refundId, pay, amount } = prepared;
  try {
    const refund = await provider!.refund(pay.provider_payment_id, amount, { booking_id: bookingId, refund_id: refundId, reason: reason.slice(0, 200) });
    await db.tx(async (q) => {
      await q.query(`UPDATE refunds SET provider_refund_id = $2, status = $3, updated_at = now() WHERE id = $1`, [refundId, refund.id, refund.status]);
      if (refund.status === "processed") await settleRefundedBooking(q, bookingId, pay.id);
    });
    return { refunded: amount };
  } catch (e) {
    // The booking stays in refund_pending so the team sees it; the failed row does not count toward totals.
    await db.query(`UPDATE refunds SET status = 'failed', reason = reason || ' — gateway error: ' || $2, updated_at = now() WHERE id = $1`, [refundId, String((e as Error).message).slice(0, 200)]);
    throw e;
  }
}


// ------------------------------------------------------------------ 180 Pay
// 180 Pay opens its own checkout sheet in the browser (amount in whole rupees). We create our
// own order reference, then verify the resulting 180 session server-side before confirming.

async function create180PayOrder(token: string) {
  const db = await getDb();
  const booking = await getBookingByToken(token, db);
  if (!booking) throw new BookingError("Booking not found", "not_found", 404);
  if (booking.status !== "pending_payment") throw new BookingError("This booking does not need a payment.", "invalid", 409);
  if (booking.hold_expires_at && new Date(booking.hold_expires_at) < new Date())
    throw new BookingError("The payment window for this booking has closed. Please book the slot again.", "invalid", 409);
  if (booking.advance_paise % 100 !== 0) throw new BookingError("Advance must be a whole rupee amount.", "invalid", 500);
  const open = await db.query<{ provider_order_id: string }>(
    `SELECT provider_order_id FROM payments WHERE booking_id = $1 AND provider = '180pay' AND status IN ('created', 'attempted', 'failed') AND amount_paise = $2
     ORDER BY created_at DESC LIMIT 1`,
    [booking.id, booking.advance_paise],
  );
  let orderId = open[0]?.provider_order_id;
  if (!orderId) {
    orderId = `vsh_${booking.code.replace("VSH-", "")}_${crypto.randomBytes(4).toString("hex")}`;
    await db.query(`INSERT INTO payments(booking_id, provider, provider_order_id, amount_paise, status) VALUES ($1, '180pay', $2, $3, 'created')`, [
      booking.id,
      orderId,
      booking.advance_paise,
    ]);
  }
  return {
    provider: "180pay" as const,
    keyId: "",
    orderId,
    amount: booking.advance_paise,
    currency: "INR",
    title: `VAISHORA booking ${booking.code}`,
    description: `Advance for ${booking.design_name}`,
    environment: "production",
    bookingCode: booking.code,
    prefill: { name: booking.customer_name, contact: booking.customer_phone, email: booking.customer_email ?? undefined },
  };
}

/** Confirms a 180 Pay checkout session for a booking: ours, paid, exact INR amount, used once. */
export async function verify180Payment(input: { bookingToken: string; orderId: string; sessionId: string }) {
  const db = await getDb();
  const booking = await getBookingByToken(input.bookingToken, db);
  if (!booking) throw new BookingError("Booking not found", "not_found", 404);
  const pay = (await db.query<{ amount_paise: number }>(`SELECT amount_paise FROM payments WHERE booking_id = $1 AND provider = '180pay' AND provider_order_id = $2`, [
    booking.id,
    input.orderId,
  ]))[0];
  if (!pay) throw new BookingError("Payment does not belong to this booking", "invalid", 400);
  const s = await fetchPaySession(input.sessionId);
  if (!s.paid) return { outcome: "pending" as const, bookingId: booking.id };
  if (s.currency !== "INR" || Math.round(s.amountRupees * 100) !== pay.amount_paise) {
    await db.query(`UPDATE payments SET failure_reason = 'amount_mismatch', raw = $2::jsonb, updated_at = now() WHERE provider_order_id = $1`, [input.orderId, JSON.stringify(s.raw)]);
    throw new BookingError("Payment amount does not match the booking. Our team has been alerted.", "invalid", 409);
  }
  // The session id is stored as provider_payment_id (unique per provider), so one paid session
  // can never confirm two bookings.
  const result = await db.tx((q) =>
    applyPayment(q, { id: s.sessionId, order_id: input.orderId, amount: pay.amount_paise, currency: "INR", status: "captured", method: "180pay" }, "system"),
  );
  return result;
}
