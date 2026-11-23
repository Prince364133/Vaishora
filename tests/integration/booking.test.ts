// Integration tests against a real (in-memory) PostgreSQL via PGlite, using the actual
// migrations. Verifies double-booking prevention, hold expiry, idempotency and payments.
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import { createBooking, getBookingById, transitionBooking, BookingError } from "@/server/bookings";
import { computeDaySlots, expireStaleHolds } from "@/server/availability";
import { getSettings, setSetting } from "@/server/settings";
import { applyPayment, cancelWithRefund, createPaymentOrder, verifyCheckout } from "@/server/payments/service";
import { mockCompletePayment } from "@/server/payments/provider";
import { addDays, istDateString } from "@/lib/time";
import type { BookingRequest } from "@/lib/schemas";

let localityId = 0;
const date = addDays(istDateString(), 3);

type Over = Partial<BookingRequest> & { customer?: { name: string; phone: string } };

async function customerId(c: { name: string; phone: string }) {
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    `INSERT INTO customers(name, phone, email, gender, address_line, locality_id, profile_completed_at)
     VALUES ($1, $2, $3, 'female', 'Flat 1, Test Street', $4, now())
     ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [c.name, c.phone, `${c.phone.slice(-4)}@example.com`, localityId],
  );
  return rows[0].id;
}

/** Creates a booking as a signed-in customer (default customer: Asha). */
async function book(over: Over, idem: string) {
  const { customer = { name: "Asha", phone: "+919876543210" }, ...rest } = over;
  return createBooking(request(rest), idem, await customerId(customer));
}

function request(over: Partial<BookingRequest> = {}): BookingRequest {
  return {
    designSlug: "test-design",
    options: {},
    specialRequirements: "",
    address: { line: "Flat 1, Test Street", localityId, city: "Hyderabad", landmark: "", instructions: "" },
    date,
    startMinute: 10 * 60,
    acceptPolicy: true,
    ...over,
  } as BookingRequest;
}

beforeAll(async () => {
  const db = await getDb();
  await db.query(`INSERT INTO design_categories(slug, name) VALUES ('mandala', 'Mandala')`);
  await db.query(
    `INSERT INTO designs(slug, name, category_slug, region, complexity, duration_minutes, base_price_paise, status)
     VALUES ('test-design', 'Test Design', 'mandala', 'palm', 'moderate', 60, 99900, 'active')`,
  );
  await db.query(`INSERT INTO pricing_rules(code, group_code, label, is_default) VALUES ('hands_one','hands','One hand',true), ('side_front','side','Front',true), ('coverage_full','coverage','Full',true)`);
  localityId = (await db.query<{ id: number }>(`INSERT INTO localities(name, zone) VALUES ('Kondapur','West') RETURNING id`))[0].id;
  const artist = (await db.query<{ id: string }>(`INSERT INTO artists(slug, name, phone, status) VALUES ('only-artist','Only Artist','+919000000001','active') RETURNING id`))[0].id;
  await db.query(`INSERT INTO artist_services VALUES ($1, 'mandala')`, [artist]);
  await db.query(`INSERT INTO artist_service_areas VALUES ($1, $2)`, [artist, localityId]);
  for (let wd = 0; wd < 7; wd++) await db.query(`INSERT INTO artist_availability(artist_id, weekday, start_minute, end_minute) VALUES ($1,$2,540,1200)`, [artist, wd]);
  await db.tx((q) => setSetting(q, "lead_time_hours", 0));
});

describe("availability and booking", () => {
  it("offers slots only within the artist's hours", async () => {
    const db = await getDb();
    const day = await computeDaySlots(db, { date, durationMinutes: 60, localityId, categorySlug: "mandala", eligibility: "standard" }, await getSettings());
    const available = day.slots.filter((s) => s.available).map((s) => s.start_minute);
    expect(available[0]).toBe(9 * 60);
    expect(available.at(-1)).toBe(19 * 60);
    expect(day.slots.find((s) => s.start_minute === 8 * 60)?.reason).toBe("no_artist");
  });

  it("never double-books one artist, even for simultaneous requests", async () => {
    const results = await Promise.allSettled([
      book({}, "idem-aaaaaaaaaaaaaaaa1"),
      book({ customer: { name: "Bina", phone: "+919876543211" } }, "idem-aaaaaaaaaaaaaaaa2"),
      book({ customer: { name: "Chitra", phone: "+919876543212" }, startMinute: 10 * 60 + 30 }, "idem-aaaaaaaaaaaaaaaa3"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const f of failed) expect((f.reason as BookingError).code).toBe("slot_taken");
  });

  it("blocks the buffer around an existing booking", async () => {
    const db = await getDb();
    const day = await computeDaySlots(db, { date, durationMinutes: 60, localityId, categorySlug: "mandala", eligibility: "standard" }, await getSettings());
    const s = (m: number) => day.slots.find((x) => x.start_minute === m)!;
    expect(s(10 * 60).available).toBe(false);
    expect(s(11 * 60 + 30).available).toBe(false); // 11:00 end + 45 min buffer on both sides
    expect(s(12 * 60 + 30).available).toBe(true);
  });

  it("is idempotent for retried requests with the same key", async () => {
    const a = await book({ startMinute: 15 * 60, date: addDays(date, 1) }, "idem-retry-0000000001");
    const b = await book({ startMinute: 15 * 60, date: addDays(date, 1) }, "idem-retry-0000000001");
    expect(b.id).toBe(a.id);
    expect(b.token).toBe(a.token);
  });

  it("enforces the exclusion constraint at the database level", async () => {
    const db = await getDb();
    const existing = (await db.query<{ artist_id: string; customer_id: string; design_id: string }>(`SELECT artist_id, customer_id, design_id FROM bookings WHERE status = 'pending_payment' LIMIT 1`))[0];
    await expect(
      db.query(
        `INSERT INTO bookings(code, access_token_hash, customer_id, design_id, artist_id, status, starts_at, ends_at, block, duration_minutes, address_line, locality_id, city, subtotal_paise, total_paise, advance_paise)
         SELECT 'VSH-ZZZZZZ', 'x', $1, $2, $3, 'confirmed', starts_at, ends_at, block, 60, 'x', locality_id, 'Hyderabad', 1, 1, 1 FROM bookings WHERE artist_id = $3 LIMIT 1`,
        [existing.customer_id, existing.design_id, existing.artist_id],
      ),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("releases expired unpaid holds", async () => {
    const db = await getDb();
    const b = await book({ startMinute: 17 * 60, date: addDays(date, 2) }, "idem-expire-000000001");
    await db.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [b.id]);
    expect(await expireStaleHolds(db)).toBeGreaterThanOrEqual(1);
    expect((await getBookingById(b.id))!.status).toBe("expired");
    const again = await book({ startMinute: 17 * 60, date: addDays(date, 2), customer: { name: "Divya", phone: "+919876543219" } }, "idem-expire-000000002");
    expect(again.status).toBe("pending_payment");
  });
});

describe("payments", () => {
  it("rejects a forged signature and confirms only after server-side verification", async () => {
    const b = await book({ startMinute: 13 * 60, date: addDays(date, 3) }, "idem-pay-00000000001");
    const order = await createPaymentOrder(b.token);
    await expect(verifyCheckout({ bookingToken: b.token, razorpay_order_id: order.orderId, razorpay_payment_id: "pay_fake", razorpay_signature: "deadbeef" })).rejects.toThrow(/signature/i);
    expect((await getBookingById(b.id))!.status).toBe("pending_payment");

    const sig = mockCompletePayment(order.orderId, order.amount, "success");
    const r = await verifyCheckout({ bookingToken: b.token, ...sig });
    expect(r.outcome).toBe("captured");
    const after = await getBookingById(b.id);
    expect(after!.status).toBe("awaiting_artist_confirmation");
    expect(after!.paid_paise).toBe(order.amount);

    // Replaying the same confirmation (e.g. webhook after callback) changes nothing.
    const db = await getDb();
    const p = { id: sig.razorpay_payment_id, order_id: order.orderId, amount: order.amount, currency: "INR", status: "captured" as const };
    await db.tx((q) => applyPayment(q, p, "webhook"));
    const history = await db.query(`SELECT 1 FROM booking_status_history WHERE booking_id = $1 AND to_status = 'paid'`, [b.id]);
    expect(history).toHaveLength(1);
  });

  it("records failed payments without confirming the booking", async () => {
    const b = await book({ startMinute: 13 * 60, date: addDays(date, 4) }, "idem-pay-00000000002");
    const order = await createPaymentOrder(b.token);
    const sig = mockCompletePayment(order.orderId, order.amount, "failure");
    const r = await verifyCheckout({ bookingToken: b.token, ...sig });
    expect(r.outcome).toBe("failed");
    expect((await getBookingById(b.id))!.status).toBe("pending_payment");
  });

  it("refuses amount mismatches", async () => {
    const b = await book({ startMinute: 13 * 60, date: addDays(date, 5), customer: { name: "Esha", phone: "+919876543218" } }, "idem-pay-00000000003");
    const order = await createPaymentOrder(b.token);
    const db = await getDb();
    await expect(
      db.tx((q) => applyPayment(q, { id: "pay_x", order_id: order.orderId, amount: order.amount - 100, currency: "INR", status: "captured" }, "webhook")),
    ).rejects.toThrow(/amount/i);
    expect((await getBookingById(b.id))!.status).toBe("pending_payment");
  });

  it("does not allow skipping states", async () => {
    const db = await getDb();
    const b = await book({ startMinute: 13 * 60, date: addDays(date, 6), customer: { name: "Farah", phone: "+919876543217" } }, "idem-pay-00000000004");
    await expect(db.tx((q) => transitionBooking(q, b.id, "completed", { type: "admin" }))).rejects.toThrow();
  });

  it("cancels with a refund, records it, and settles the booking as refunded", async () => {
    const db = await getDb();
    const b = await book({ startMinute: 13 * 60, date: addDays(date, 7), customer: { name: "Gita", phone: "+919876543216" } }, "idem-refund-000000001");
    const order = await createPaymentOrder(b.token);
    await verifyCheckout({ bookingToken: b.token, ...mockCompletePayment(order.orderId, order.amount, "success") });
    const half = Math.floor(order.amount / 2 / 100) * 100;
    const r1 = await cancelWithRefund(b.id, half, { type: "admin" }, "Partial refund test");
    expect(r1.refunded).toBe(half);
    let after = await getBookingById(b.id);
    expect(after!.status).toBe("refunded");
    expect(after!.refunded_paise).toBe(half);
    const pay = await db.query<{ status: string }>(`SELECT status FROM payments WHERE booking_id = $1 AND status <> 'failed'`, [b.id]);
    expect(pay[0].status).toBe("partially_refunded");
    // Refunding more than was paid is impossible.
    await expect(cancelWithRefund(b.id, order.amount, { type: "admin" }, "Too much")).rejects.toThrow();
    after = await getBookingById(b.id);
    expect(after!.refunded_paise).toBe(half);
  });

  it("cancels an unpaid booking without touching payments", async () => {
    const b = await book({ startMinute: 13 * 60, date: addDays(date, 8), customer: { name: "Hema", phone: "+919876543215" } }, "idem-refund-000000002");
    const r = await cancelWithRefund(b.id, 0, { type: "customer" }, "Changed plans");
    expect(r.refunded).toBe(0);
    expect((await getBookingById(b.id))!.status).toBe("cancelled");
  });

  it("late payment after hold expiry: keeps the slot if free, otherwise needs manual assignment", async () => {
    const db = await getDb();
    const d = addDays(date, 9);
    // free case
    const a = await book({ startMinute: 13 * 60, date: d, customer: { name: "Indu", phone: "+919876543214" } }, "idem-late-0000000001");
    const oa = await createPaymentOrder(a.token);
    await db.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [a.id]);
    await expireStaleHolds(db);
    await verifyCheckout({ bookingToken: a.token, ...mockCompletePayment(oa.orderId, oa.amount, "success") });
    expect((await getBookingById(a.id))!.status).toBe("awaiting_artist_confirmation");
    // taken case
    const b = await book({ startMinute: 16 * 60, date: d, customer: { name: "Jaya", phone: "+919876543213" } }, "idem-late-0000000002");
    const ob = await createPaymentOrder(b.token);
    await db.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [b.id]);
    await expireStaleHolds(db);
    await book({ startMinute: 16 * 60, date: d, customer: { name: "Kavya", phone: "+919876543212" } }, "idem-late-0000000003");
    await verifyCheckout({ bookingToken: b.token, ...mockCompletePayment(ob.orderId, ob.amount, "success") });
    const after = await getBookingById(b.id);
    expect(after!.status).toBe("awaiting_artist_assignment");
    expect(after!.artist_id).toBeNull();
  });
});
