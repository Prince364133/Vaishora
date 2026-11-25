// Saved addresses, locality matching and customer support tickets on a real (in-memory) PostgreSQL.
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import { createBooking, getBookingById, BookingError } from "@/server/bookings";
import { setSetting } from "@/server/settings";
import { createAddress, deleteAddress, listAddresses } from "@/server/customer-addresses";
import { resolveLocality } from "@/server/maps";
import { createTicket, getTicket, listTickets, replyToTicket } from "@/server/support";
import { addDays, istDateString } from "@/lib/time";
import type { BookingRequest } from "@/lib/schemas";

const date = addDays(istDateString(), 5);
let kondapur = 0;
let gachibowli = 0;
let asha = "";
let bina = "";

const place = (lat: number, lng: number, names: [string, string][] = []) => ({
  placeId: null,
  formatted: "Somewhere, Hyderabad, Telangana",
  lat,
  lng,
  components: names.map(([longText, t]) => ({ longText, types: [t, "political"] })),
});

function request(over: Partial<BookingRequest["address"]>, minute: number): BookingRequest {
  return {
    designSlug: "addr-design",
    options: {},
    specialRequirements: "",
    address: { line: "placeholder address line", localityId: kondapur, city: "Hyderabad", landmark: "", instructions: "", ...over },
    date,
    startMinute: minute,
    acceptPolicy: true,
  } as BookingRequest;
}

beforeAll(async () => {
  const db = await getDb();
  await db.query(`INSERT INTO design_categories(slug, name) VALUES ('addr-cat', 'Addr') ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO pricing_rules(code, group_code, label, is_default) VALUES ('hands_one','hands','One hand',true), ('side_front','side','Front',true), ('coverage_full','coverage','Full',true) ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO designs(slug, name, category_slug, region, complexity, duration_minutes, base_price_paise, status) VALUES ('addr-design','Addr Design','addr-cat','palm','simple',60,50000,'active')`);
  kondapur = (await db.query<{ id: number }>(`INSERT INTO localities(name, zone, lat, lng) VALUES ('Kondapur Test','West',17.4700,78.3600) RETURNING id`))[0].id;
  gachibowli = (await db.query<{ id: number }>(`INSERT INTO localities(name, zone, lat, lng) VALUES ('Gachibowli Test','West',17.4400,78.3480) RETURNING id`))[0].id;
  const artist = (await db.query<{ id: string }>(`INSERT INTO artists(slug, name, phone, status) VALUES ('addr-artist','Addr Artist','+919000033333','active') RETURNING id`))[0].id;
  await db.query(`INSERT INTO artist_services VALUES ($1,'addr-cat')`, [artist]);
  await db.query(`INSERT INTO artist_service_areas VALUES ($1,$2), ($1,$3)`, [artist, kondapur, gachibowli]);
  for (let wd = 0; wd < 7; wd++) await db.query(`INSERT INTO artist_availability(artist_id, weekday, start_minute, end_minute) VALUES ($1,$2,480,1260)`, [artist, wd]);
  const mk = async (name: string, phone: string) =>
    (await db.query<{ id: string }>(`INSERT INTO customers(name, phone, email, gender, profile_completed_at) VALUES ($1,$2,$3,'female',now()) RETURNING id`, [name, phone, `${name}@example.com`]))[0].id;
  asha = await mk("asha", "+919811100001");
  bina = await mk("bina", "+919811100002");
  await db.tx((q) => setSetting(q, "lead_time_hours", 0));
});

describe("locality matching", () => {
  it("matches by the area name Google gives", async () => {
    const r = await resolveLocality(await getDb(), place(17.48, 78.37, [["Kondapur Test", "neighborhood"]]));
    expect(r).toMatchObject({ id: kondapur, match: "name" });
  });
  it("falls back to the nearest locality within a few km", async () => {
    const r = await resolveLocality(await getDb(), place(17.4415, 78.3495, [["Some Colony", "sublocality_level_2"]]));
    expect(r).toMatchObject({ id: gachibowli, match: "nearest" });
  });
  it("creates a new locality from Google's data for an unknown far area", async () => {
    const r = await resolveLocality(await getDb(), place(17.36, 78.55, [["Far Nagar", "neighborhood"]]));
    expect(r.match).toBe("new");
    expect(r.name).toBe("Far Nagar");
  });
  it("refuses addresses outside Hyderabad", async () => {
    await expect(resolveLocality(await getDb(), place(12.97, 77.59, [["Indiranagar", "neighborhood"]]))).rejects.toThrow(/Hyderabad/);
  });
});

describe("saved addresses and bookings", () => {
  it("first address becomes the default; default moves when it is deleted", async () => {
    const db = await getDb();
    const a1 = await db.tx((q) => createAddress(q, asha, { label: "Home", house: "Flat 12", building: "Lake View", formatted_address: "Kondapur, Hyderabad", lat: 17.47, lng: 78.36, locality_id: kondapur, landmark: "", instructions: "Gate 2" }));
    const a2 = await db.tx((q) => createAddress(q, asha, { label: "Work", house: "4th floor", building: "Tower B", formatted_address: "Gachibowli, Hyderabad", lat: 17.44, lng: 78.35, locality_id: gachibowli, landmark: "", instructions: "" }));
    expect(a1.is_default).toBe(true);
    expect(a2.is_default).toBe(false);
    await db.tx((q) => deleteAddress(q, asha, a1.id));
    const list = await listAddresses(db, asha);
    expect(list).toHaveLength(1);
    expect(list[0].is_default).toBe(true);
  });

  it("books at a saved address (its locality, coordinates and line)", async () => {
    const db = await getDb();
    const [work] = await listAddresses(db, asha);
    const b = await createBooking(request({ id: work.id }, 10 * 60), "idem-addr-saved-00001", asha);
    const v = await getBookingById(b.id);
    expect(v!.address_line).toBe("4th floor, Tower B, Gachibowli, Hyderabad");
    expect(v!.locality).toBe("Gachibowli Test");
    const row = (await db.query<{ lat: number; address_id: string }>(`SELECT lat, address_id FROM bookings WHERE id = $1`, [b.id]))[0];
    expect(row.address_id).toBe(work.id);
    expect(row.lat).toBeCloseTo(17.44);
  });

  it("never lets one customer book with another customer's saved address", async () => {
    const [work] = await listAddresses(await getDb(), asha);
    await expect(createBooking(request({ id: work.id }, 13 * 60), "idem-addr-steal-00001", bina)).rejects.toBeInstanceOf(BookingError);
  });

  it("saves a new map address to the account when booking with save: true", async () => {
    const db = await getDb();
    await createBooking(
      request({ line: "Villa 7, Palm Meadows, Kondapur, Hyderabad", localityId: kondapur, house: "Villa 7", building: "Palm Meadows", formatted: "Kondapur, Hyderabad", lat: 17.471, lng: 78.361, label: "Mom's place", save: true }, 15 * 60),
      "idem-addr-new-000001",
      bina,
    );
    const list = await listAddresses(db, bina);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: "Mom's place", house: "Villa 7", locality_id: kondapur, is_default: true });
  });
});

describe("customer support tickets", () => {
  it("customers see only their own tickets; team replies wait for the customer", async () => {
    const db = await getDb();
    const t = await db.tx((q) => createTicket(q, { customerId: asha, requesterName: "Asha", requesterContact: "+919811100001", subject: "Change my time", category: "booking", priority: "normal", body: "Can I move it by an hour?", authorId: asha }));
    expect((await listTickets(db, { customerId: asha })).map((x) => x.id)).toContain(t.id);
    expect(await listTickets(db, { customerId: bina })).toHaveLength(0);
    expect(await getTicket(db, t.id, { customerId: bina })).toBeNull();
    await db.tx((q) => replyToTicket(q, t.id, { authorType: "admin", authorId: asha, authorName: "Team", body: "Yes, done." }));
    expect((await getTicket(db, t.id, { customerId: asha }))!.ticket.status).toBe("awaiting_reply");
    await db.tx((q) => replyToTicket(q, t.id, { authorType: "customer", authorId: asha, authorName: "Asha", body: "Thanks!" }));
    const after = (await getTicket(db, t.id, { customerId: asha }))!;
    expect(after.ticket.status).toBe("open");
    expect(after.messages.map((m) => m.author_type)).toEqual(["customer", "admin", "customer"]);
  });
});
