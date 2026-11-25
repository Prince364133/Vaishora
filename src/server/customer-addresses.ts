import "server-only";
import { z } from "zod";
import { Queryable } from "./db";

// A customer's saved addresses (picked on Google Maps, then flat / building details added).

export interface CustomerAddress {
  id: string;
  label: string;
  house: string;
  building: string;
  formatted_address: string;
  place_id: string | null;
  lat: number;
  lng: number;
  locality_id: number;
  locality: string;
  landmark: string;
  instructions: string;
  is_default: boolean;
}

export const addressInputSchema = z.object({
  label: z.string().trim().min(1).max(30).default("Home"),
  house: z.string().trim().min(1, "Enter the flat / house number").max(80),
  building: z.string().trim().max(120).default(""),
  formatted_address: z.string().trim().min(5).max(300),
  place_id: z.string().trim().max(300).nullable().optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  locality_id: z.coerce.number().int().positive(),
  landmark: z.string().trim().max(120).default(""),
  instructions: z.string().trim().max(300).default(""),
  is_default: z.boolean().optional(),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

const SELECT = `SELECT a.id, a.label, a.house, a.building, a.formatted_address, a.place_id, a.lat, a.lng, a.locality_id, l.name AS locality,
  a.landmark, a.instructions, a.is_default FROM customer_addresses a JOIN localities l ON l.id = a.locality_id`;

export async function listAddresses(q: Queryable, customerId: string): Promise<CustomerAddress[]> {
  return q.query<CustomerAddress>(`${SELECT} WHERE a.customer_id = $1 ORDER BY a.is_default DESC, a.updated_at DESC`, [customerId]);
}

export async function getAddress(q: Queryable, customerId: string, id: string): Promise<CustomerAddress | null> {
  return (await q.query<CustomerAddress>(`${SELECT} WHERE a.customer_id = $1 AND a.id = $2`, [customerId, id]))[0] ?? null;
}

/** One line for bookings and the artist: "Flat 12, Lake View Towers, Kondapur, Hyderabad, Telangana 500084". */
export const addressLine = (a: Pick<AddressInput, "house" | "building" | "formatted_address">) =>
  [a.house, a.building, a.formatted_address].map((x) => x.trim()).filter(Boolean).join(", ").slice(0, 240);

/** Keeps the legacy single address on the customer row in sync with their default address. */
async function syncCustomerDefault(q: Queryable, customerId: string) {
  const d = (await q.query<CustomerAddress>(`${SELECT} WHERE a.customer_id = $1 ORDER BY a.is_default DESC, a.updated_at DESC LIMIT 1`, [customerId]))[0];
  if (d) await q.query(`UPDATE customers SET address_line = $2, locality_id = $3, landmark = $4, updated_at = now() WHERE id = $1`, [customerId, addressLine(d), d.locality_id, d.landmark]);
}

export async function createAddress(q: Queryable, customerId: string, input: AddressInput): Promise<CustomerAddress> {
  const loc = await q.query(`SELECT 1 FROM localities WHERE id = $1 AND active`, [input.locality_id]);
  if (!loc.length) throw new Error("We do not serve this locality yet.");
  const count = (await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM customer_addresses WHERE customer_id = $1`, [customerId]))[0].n;
  if (count >= 20) throw new Error("You can save up to 20 addresses. Remove one first.");
  const makeDefault = input.is_default || count === 0;
  if (makeDefault) await q.query(`UPDATE customer_addresses SET is_default = false WHERE customer_id = $1 AND is_default`, [customerId]);
  const r = await q.query<{ id: string }>(
    `INSERT INTO customer_addresses(customer_id, label, house, building, formatted_address, place_id, lat, lng, locality_id, landmark, instructions, is_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [customerId, input.label, input.house, input.building, input.formatted_address, input.place_id ?? null, input.lat, input.lng, input.locality_id, input.landmark, input.instructions, makeDefault],
  );
  await syncCustomerDefault(q, customerId);
  return (await getAddress(q, customerId, r[0].id))!;
}

export async function updateAddress(q: Queryable, customerId: string, id: string, patch: Partial<AddressInput>) {
  const cur = await getAddress(q, customerId, id);
  if (!cur) throw new Error("Address not found.");
  const next = { ...cur, ...patch };
  if (patch.is_default) await q.query(`UPDATE customer_addresses SET is_default = false WHERE customer_id = $1 AND is_default AND id <> $2`, [customerId, id]);
  await q.query(
    `UPDATE customer_addresses SET label=$3, house=$4, building=$5, landmark=$6, instructions=$7, is_default = $8, updated_at = now() WHERE id = $1 AND customer_id = $2`,
    [id, customerId, next.label, next.house, next.building, next.landmark, next.instructions, patch.is_default ?? cur.is_default],
  );
  await syncCustomerDefault(q, customerId);
  return (await getAddress(q, customerId, id))!;
}

export async function deleteAddress(q: Queryable, customerId: string, id: string) {
  const cur = await getAddress(q, customerId, id);
  if (!cur) return;
  await q.query(`DELETE FROM customer_addresses WHERE id = $1 AND customer_id = $2`, [id, customerId]);
  if (cur.is_default) {
    const next = (await q.query<{ id: string }>(`SELECT id FROM customer_addresses WHERE customer_id = $1 ORDER BY updated_at DESC LIMIT 1`, [customerId]))[0];
    if (next) await q.query(`UPDATE customer_addresses SET is_default = true WHERE id = $1`, [next.id]);
  }
  await syncCustomerDefault(q, customerId);
}
