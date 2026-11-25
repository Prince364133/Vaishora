import "server-only";
import { getDb, Queryable } from "./db";
import type { PricingSettings } from "@/lib/pricing";

export interface BusinessSettings extends PricingSettings {
  buffer_minutes: number; // travel + preparation, before and after each booking
  lead_time_hours: number; // earliest bookable start from now
  slot_interval_minutes: number;
  hold_minutes: number; // how long an unpaid booking reserves the slot
  booking_window_days: number;
  service_start_minute: number; // earliest start offered to customers (IST)
  service_end_minute: number; // latest end (IST)
  allow_demo_artists: boolean;
  platform_margin_bp: number; // central platform margin on each booking total, in basis points (2000 = 20%)
  payout_min_paise: number; // smallest payout an artist can request
  cancellation: { full_refund_hours: number; partial_refund_hours: number; partial_refund_percent: number };
  support: { phone: string; whatsapp: string; email: string; hours: string };
}

export const DEFAULT_SETTINGS: BusinessSettings = {
  gst_enabled: false,
  gst_rate_bp: 1800,
  advance_percent: 30,
  platform_fee_paise: 0,
  buffer_minutes: 45,
  lead_time_hours: 12,
  slot_interval_minutes: 30,
  hold_minutes: 15,
  booking_window_days: 60,
  service_start_minute: 8 * 60,
  service_end_minute: 21 * 60,
  allow_demo_artists: process.env.NODE_ENV !== "production",
  platform_margin_bp: 2000,
  payout_min_paise: 50_000,
  cancellation: { full_refund_hours: 48, partial_refund_hours: 12, partial_refund_percent: 50 },
  support: { phone: "", whatsapp: "", email: "", hours: "10 AM – 8 PM IST" },
};

export async function getSettings(q?: Queryable): Promise<BusinessSettings> {
  const db = q ?? (await getDb());
  const rows = await db.query<{ key: string; value: unknown }>(`SELECT key, value FROM settings`);
  const out = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  for (const r of rows) out[r.key] = r.value;
  // Environment overrides for contact details so they are never hard-coded.
  const s = out as unknown as BusinessSettings;
  s.support = {
    ...s.support,
    phone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || s.support.phone,
    whatsapp: process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || s.support.whatsapp,
    email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || s.support.email,
  };
  return s;
}

export async function setSetting(q: Queryable, key: keyof BusinessSettings, value: unknown) {
  await q.query(
    `INSERT INTO settings(key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
