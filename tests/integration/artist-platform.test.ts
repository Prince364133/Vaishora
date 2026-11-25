// Artist platform against a real (in-memory) PostgreSQL via PGlite with the actual migrations:
// artist-owned designs book only their owner within the owner's hours, daily caps, moderation,
// the earnings ledger and payouts, and 180 Identity → artist matching.
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import { createBooking, getBookingById, transitionBooking, BookingError } from "@/server/bookings";
import { computeDaySlots } from "@/server/availability";
import { getSettings, setSetting } from "@/server/settings";
import { createPaymentOrder, verifyCheckout } from "@/server/payments/service";
import { mockCompletePayment } from "@/server/payments/provider";
import { artistBalance, LedgerError, processPayout, requestPayout } from "@/server/ledger";
import { findArtistForIdentity, matchArtistForIdentity, normaliseIndianPhone } from "@/server/artist-auth";
import { getOnboarding, saveSchedule } from "@/server/artist-portal";
import { listDesigns } from "@/server/catalog";
import { encryptField } from "@/server/vault";
import { applySnapshot, currentSnapshot } from "@/server/design-revisions";
import { addDays, istDateString } from "@/lib/time";
import type { BookingRequest } from "@/lib/schemas";

const date = addDays(istDateString(), 4);
let localityId = 0;
let owner = "";
let other = "";
let adminId = "";
let customer = "";

function request(over: Partial<BookingRequest> = {}): BookingRequest {
  return {
    designSlug: "owner-bridal",
    options: {},
    specialRequirements: "",
    address: { line: "Flat 9, Artist Test Road", localityId, city: "Hyderabad", landmark: "", instructions: "" },
    date,
    startMinute: 11 * 60,
    acceptPolicy: true,
    ...over,
  } as BookingRequest;
}

async function payAndComplete(bookingId: string, token: string) {
  const order = await createPaymentOrder(token);
  await verifyCheckout({ bookingToken: token, ...mockCompletePayment(order.orderId, order.amount, "success") });
  const db = await getDb();
  await db.tx((q) => transitionBooking(q, bookingId, "confirmed", { type: "artist" }));
  await db.tx((q) => transitionBooking(q, bookingId, "in_progress", { type: "artist" }));
  await db.tx((q) => transitionBooking(q, bookingId, "completed", { type: "artist" }));
  return order.amount;
}

beforeAll(async () => {
  const db = await getDb();
  await db.query(`INSERT INTO design_categories(slug, name) VALUES ('bridal-ap', 'Bridal AP') ON CONFLICT DO NOTHING`);
  await db.query(
    `INSERT INTO pricing_rules(code, group_code, label, is_default) VALUES ('hands_one','hands','One hand',true), ('side_front','side','Front',true), ('coverage_full','coverage','Full',true) ON CONFLICT DO NOTHING`,
  );
  localityId = (await db.query<{ id: number }>(`INSERT INTO localities(name, zone) VALUES ('Artistpur','West') RETURNING id`))[0].id;
  const mk = async (slug: string, email: string) => {
    const id = (await db.query<{ id: string }>(`INSERT INTO artists(slug, name, phone, email, status) VALUES ($1, $1, '+919000011111', $2, 'active') RETURNING id`, [slug, email]))[0].id;
    await db.query(`INSERT INTO artist_service_areas VALUES ($1, $2)`, [id, localityId]);
    await db.query(`INSERT INTO artist_services VALUES ($1, 'bridal-ap')`, [id]);
    return id;
  };
  owner = await mk("owner-artist", "owner@example.com");
  other = await mk("other-artist", "other@example.com");
  // Owner works 10:00–13:00 and 15:00–18:00 every day (a split shift); the other artist all day.
  await db.tx((q) => saveSchedule(q, owner, Array.from({ length: 7 }, (_, weekday) => ({ weekday, windows: [{ start: 600, end: 780 }, { start: 900, end: 1080 }] }))));
  await db.tx((q) => saveSchedule(q, other, Array.from({ length: 7 }, (_, weekday) => ({ weekday, windows: [{ start: 480, end: 1260 }] }))));
  await db.query(
    `INSERT INTO designs(slug, name, category_slug, region, complexity, duration_minutes, base_price_paise, status, artist_id, review_status)
     VALUES ('owner-bridal', 'Owner Bridal', 'bridal-ap', 'palm', 'bridal', 120, 200000, 'active', $1, 'approved'),
            ('owner-pending', 'Owner Pending', 'bridal-ap', 'palm', 'simple', 60, 100000, 'active', $1, 'pending')`,
    [owner],
  );
  adminId = (await db.query<{ id: string }>(`INSERT INTO users(email, name, password_hash, role) VALUES ('ap-admin@example.com','Admin','x','admin') RETURNING id`))[0].id;
  customer = (
    await db.query<{ id: string }>(
      `INSERT INTO customers(name, phone, email, gender, address_line, locality_id, profile_completed_at)
       VALUES ('Meera', '+919811122233', 'meera@example.com', 'female', 'Flat 9, Artist Test Road', $1, now()) RETURNING id`,
      [localityId],
    )
  )[0].id;
  await db.tx(async (q) => {
    await setSetting(q, "lead_time_hours", 0);
    await setSetting(q, "buffer_minutes", 30);
    await setSetting(q, "platform_margin_bp", 2000);
    await setSetting(q, "payout_min_paise", 10_000);
  });
});

describe("artist-owned designs", () => {
  it("offers only the owner's split-shift hours, sized to the design duration", async () => {
    const db = await getDb();
    const day = await computeDaySlots(db, { date, durationMinutes: 120, localityId, categorySlug: "bridal-ap", eligibility: "standard", artistId: owner }, await getSettings());
    const free = day.slots.filter((s) => s.available).map((s) => s.start_minute);
    expect(free).toContain(600); // 10:00–12:00
    expect(free).toContain(660); // 11:00–13:00
    expect(free).not.toContain(690); // would end 13:30, after the morning window
    expect(free).toContain(900);
    expect(free.at(-1)).toBe(960); // 16:00–18:00
    expect([...day.free.values()].flat().every((id) => id === owner)).toBe(true);
  });

  it("books the owner, never another artist", async () => {
    const b = await createBooking(request(), "idem-artist-own-000001", customer);
    expect((await getBookingById(b.id))!.artist_id).toBe(owner);
  });

  it("does not list or book a design that is still in review", async () => {
    const db = await getDb();
    expect((await listDesigns({}, db)).some((d) => d.slug === "owner-pending")).toBe(false);
    await expect(createBooking(request({ designSlug: "owner-pending", startMinute: 15 * 60 }), "idem-artist-pend-00001", customer)).rejects.toBeInstanceOf(BookingError);
  });

  it("respects the artist's daily booking cap", async () => {
    const db = await getDb();
    await db.query(`UPDATE artists SET max_bookings_per_day = 1 WHERE id = $1`, [owner]);
    const day = await computeDaySlots(db, { date, durationMinutes: 120, localityId, categorySlug: "bridal-ap", eligibility: "standard", artistId: owner }, await getSettings());
    expect(day.slots.some((s) => s.available)).toBe(false);
    await db.query(`UPDATE artists SET max_bookings_per_day = NULL WHERE id = $1`, [owner]);
  });

  it("stops offering the design when the artist is suspended", async () => {
    const db = await getDb();
    await db.query(`UPDATE artists SET status = 'suspended' WHERE id = $1`, [owner]);
    expect((await listDesigns({}, db)).some((d) => d.slug === "owner-bridal")).toBe(false);
    await expect(createBooking(request({ startMinute: 16 * 60 }), "idem-artist-susp-00001", customer)).rejects.toBeInstanceOf(BookingError);
    await db.query(`UPDATE artists SET status = 'active' WHERE id = $1`, [owner]);
  });
});

describe("earnings and payouts", () => {
  it("credits advance − margin once when the booking is completed", async () => {
    const db = await getDb();
    const b = await createBooking(request({ date: addDays(date, 1), startMinute: 15 * 60 }), "idem-artist-earn-00001", customer);
    const advance = await payAndComplete(b.id, b.token);
    const total = (await getBookingById(b.id))!.total_paise;
    const rows = await db.query<{ amount_paise: number; margin_paise: number; cash_paise: number }>(`SELECT amount_paise, margin_paise, cash_paise FROM artist_ledger WHERE booking_id = $1`, [b.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].margin_paise).toBe(Math.round(total * 0.2));
    expect(rows[0].amount_paise).toBe(advance - Math.round(total * 0.2));
    expect(rows[0].cash_paise).toBe(total - advance);
  });

  it("reserves a payout, returns it on rejection, and enforces the rules", async () => {
    const db = await getDb();
    // Give the artist a clear positive balance to work with.
    await db.query(`INSERT INTO artist_ledger(artist_id, kind, amount_paise, note) VALUES ($1, 'adjustment', 100000, 'test credit')`, [owner]);
    await expect(db.tx((q) => requestPayout(q, owner, 50_000))).rejects.toBeInstanceOf(LedgerError); // no bank yet
    await db.query(`INSERT INTO artist_bank_accounts(artist_id, holder_name, account_enc, account_last4, ifsc) VALUES ($1, 'Owner', $2, '9012', 'HDFC0001234')`, [owner, encryptField("123456789012")]);
    const before = await artistBalance(db, owner);
    await expect(db.tx((q) => requestPayout(q, owner, 5_000))).rejects.toThrow(/minimum/i);
    await expect(db.tx((q) => requestPayout(q, owner, before.available_paise + 100))).rejects.toThrow(/more than/i);
    const id = await db.tx((q) => requestPayout(q, owner, 50_000));
    expect((await artistBalance(db, owner)).available_paise).toBe(before.available_paise - 50_000);
    await expect(db.tx((q) => requestPayout(q, owner, 10_000))).rejects.toThrow(/in progress/i);
    await db.tx((q) => processPayout(q, id, "reject", adminId, { note: "Wrong bank" }));
    expect((await artistBalance(db, owner)).available_paise).toBe(before.available_paise);
    // A new request can be paid; paid needs a bank reference.
    const id2 = await db.tx((q) => requestPayout(q, owner, 40_000));
    await expect(db.tx((q) => processPayout(q, id2, "paid", adminId, {}))).rejects.toThrow(/reference/i);
    await db.tx((q) => processPayout(q, id2, "paid", adminId, { reference: "UTR123" }));
    const after = await artistBalance(db, owner);
    expect(after.paid_out_paise).toBe(40_000);
    expect(after.available_paise).toBe(before.available_paise - 40_000);
    await expect(db.tx((q) => processPayout(q, id2, "reject", adminId, { note: "late" }))).rejects.toThrow(/already/i);
  });
});

describe("sign-in matching and onboarding", () => {
  it("matches a verified email, binds the 180 subject and blocks takeovers", async () => {
    const db = await getDb();
    expect(await findArtistForIdentity(db, { sub: "sub-other", email: "other@example.com", emailVerified: false, name: null, phone: null, phoneVerified: true })).toBeNull();
    expect(await findArtistForIdentity(db, { sub: "sub-other", email: "other@example.com", emailVerified: true, name: null, phone: null, phoneVerified: true })).toBe(other);
    await db.query(`UPDATE artists SET identity_sub = 'sub-other' WHERE id = $1`, [other]);
    expect(await findArtistForIdentity(db, { sub: "sub-attacker", email: "other@example.com", emailVerified: true, name: null, phone: null, phoneVerified: true })).toBeNull();
    expect(await findArtistForIdentity(db, { sub: "sub-other", email: "changed@example.com", emailVerified: true, name: null, phone: null, phoneVerified: true })).toBe(other);
    expect(await findArtistForIdentity(db, { sub: "sub-nobody", email: "customer@example.com", emailVerified: true, name: null, phone: null, phoneVerified: true })).toBeNull();
  });

  it("matches by application phone when 180 shares no matching email, and explains misses", async () => {
    const db = await getDb();
    const id = (await db.query<{ id: string }>(`INSERT INTO artists(slug, name, phone, email, status) VALUES ('phone-artist', 'Phone', '+919000033333', 'phone-artist@example.com', 'pending') RETURNING id`))[0].id;
    const base = { name: null, emailVerified: true, phoneVerified: true };
    expect(normaliseIndianPhone("91 90000 33333")).toBe("+919000033333");
    expect(normaliseIndianPhone("09000033333")).toBe("+919000033333");
    expect(await matchArtistForIdentity(db, { ...base, sub: "sub-x", email: null, phone: null })).toEqual({ artistId: null, reason: "no_contact" });
    expect(await matchArtistForIdentity(db, { ...base, sub: "sub-x", email: "someone@example.com", phone: null })).toEqual({ artistId: null, reason: "not_found" });
    expect(await matchArtistForIdentity(db, { ...base, sub: "sub-p", email: "different@example.com", phone: "+91 90000 33333", phoneVerified: false })).toEqual({ artistId: null, reason: "unverified" });
    expect(await matchArtistForIdentity(db, { ...base, sub: "sub-p", email: "different@example.com", phone: "9000033333" })).toEqual({ artistId: id, reason: "phone" });
    await db.query(`UPDATE artists SET identity_sub = 'sub-p' WHERE id = $1`, [id]);
    expect(await matchArtistForIdentity(db, { ...base, sub: "sub-q", email: null, phone: "9000033333" })).toEqual({ artistId: null, reason: "bound_elsewhere" });
    expect(await matchArtistForIdentity(db, { ...base, sub: "sub-p", email: null, phone: null })).toEqual({ artistId: id, reason: "bound" });
  });

  it("reports what is missing before an artist is bookable", async () => {
    const db = await getDb();
    const id = (await db.query<{ id: string }>(`INSERT INTO artists(slug, name, phone, email, status) VALUES ('new-artist', 'New', '+919000022222', 'new@example.com', 'pending') RETURNING id`))[0].id;
    const o = await getOnboarding(db, id);
    expect(o.bookable).toBe(false);
    expect(o.missingForBookable).toEqual(["account approval", "service areas", "specialties", "working hours"]);
    expect(o.done).toBe(0);
    expect((await getOnboarding(db, owner)).bookable).toBe(true);
  });

  it("rejects overlapping schedule windows", async () => {
    const db = await getDb();
    await expect(db.tx((q) => saveSchedule(q, owner, [{ weekday: 1, windows: [{ start: 600, end: 800 }, { start: 700, end: 900 }] }]))).rejects.toThrow(/overlap/);
  });
});

describe("design revisions", () => {
  it("keeps the live version on sale while an edit waits, then applies it on approval", async () => {
    const db = await getDb();
    const id = (await db.query<{ id: string }>(`SELECT id FROM designs WHERE slug = 'owner-bridal'`))[0].id;
    const live = (await currentSnapshot(db, id))!;
    const edit = { ...live, name: "Owner Bridal Deluxe", base_price_paise: 260000, photos: ["/uploads/designs/new.jpg"], video_url: "https://youtu.be/z96hSI23fGg" };
    await db.query(`UPDATE designs SET pending_changes = $2::jsonb, pending_submitted_at = now() WHERE id = $1`, [id, JSON.stringify(edit)]);
    // public still sees the approved version
    const listed = (await listDesigns({}, db)).find((d) => d.slug === "owner-bridal")!;
    expect(listed.name).toBe("Owner Bridal");
    expect(listed.base_price_paise).toBe(200000);
    // the artist sees their edit
    expect((await currentSnapshot(db, id))!.name).toBe("Owner Bridal Deluxe");
    // approval applies it in one step
    await db.tx((q) => applySnapshot(q, id, edit));
    await db.query(`UPDATE designs SET pending_changes = NULL WHERE id = $1`, [id]);
    const after = (await listDesigns({}, db)).find((d) => d.slug === "owner-bridal")!;
    expect(after.name).toBe("Owner Bridal Deluxe");
    expect(after.base_price_paise).toBe(260000);
    expect(after.photos).toEqual(["/uploads/designs/new.jpg"]);
    expect(after.video_url).toBe("https://youtu.be/z96hSI23fGg");
  });

  it("hides a design the artist takes off the store (unlive) and stops bookings", async () => {
    const db = await getDb();
    await db.query(`UPDATE designs SET status = 'unavailable' WHERE slug = 'owner-bridal'`);
    expect((await listDesigns({}, db)).some((d) => d.slug === "owner-bridal")).toBe(false);
    await expect(createBooking(request({ date: addDays(date, 2), startMinute: 15 * 60 }), "idem-artist-unlive-001", customer)).rejects.toBeInstanceOf(BookingError);
    await db.query(`UPDATE designs SET status = 'active' WHERE slug = 'owner-bridal'`);
    expect((await listDesigns({}, db)).some((d) => d.slug === "owner-bridal")).toBe(true);
  });
});
