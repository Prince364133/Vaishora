import "server-only";
import crypto from "node:crypto";
import { Queryable } from "./db";
import { BookingStatus } from "@/lib/booking-status";
import type { AssetKind, DesignSnapshot } from "./design-revisions";

// Read models and helpers for the artist portal. Every query is scoped by the signed-in artist's id;
// callers obtain it from requireArtist()/artistForAction(), never from the request.

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "artist"
  );
}

export async function uniqueArtistSlug(q: Queryable, name: string) {
  const base = slugify(name);
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? base : `${base}-${crypto.randomBytes(2).toString("hex")}`;
    if (!(await q.query(`SELECT 1 FROM artists WHERE slug = $1`, [slug])).length) return slug;
  }
  return `${base}-${crypto.randomBytes(4).toString("hex")}`;
}

export async function uniqueDesignSlug(q: Queryable, name: string, artistSlug: string) {
  const base = slugify(`${name}-${artistSlug}`).slice(0, 60);
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? base : `${base}-${crypto.randomBytes(2).toString("hex")}`;
    if (!(await q.query(`SELECT 1 FROM designs WHERE slug = $1`, [slug])).length) return slug;
  }
  return `${base}-${crypto.randomBytes(4).toString("hex")}`;
}

// ------------------------------------------------------------------ profile

export interface ArtistProfile {
  id: string;
  slug: string;
  name: string;
  email: string | null;
  phone: string;
  bio: string;
  photo_url: string | null;
  instagram: string | null;
  experience_years: number | null;
  experience_verified: boolean;
  languages: string;
  city: string;
  status: "pending" | "active" | "suspended" | "rejected";
  max_bookings_per_day: number | null;
  services: string[];
  localities: number[];
  portfolio: { id: string; image_url: string; caption: string }[];
}

export async function getArtistProfile(q: Queryable, artistId: string): Promise<ArtistProfile | null> {
  const rows = await q.query<ArtistProfile>(
    `SELECT a.id, a.slug, a.name, a.email, a.phone, a.bio, a.photo_url, a.instagram, a.experience_years, a.experience_verified,
            a.languages, a.city, a.status, a.max_bookings_per_day,
            COALESCE((SELECT array_agg(category_slug) FROM artist_services WHERE artist_id = a.id), '{}') AS services,
            COALESCE((SELECT array_agg(locality_id) FROM artist_service_areas WHERE artist_id = a.id), '{}') AS localities,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'image_url', p.image_url, 'caption', p.caption) ORDER BY p.sort)
                      FROM artist_portfolios p WHERE p.artist_id = a.id), '[]'::jsonb) AS portfolio
     FROM artists a WHERE a.id = $1`,
    [artistId],
  );
  return rows[0] ?? null;
}

// ------------------------------------------------------------------ onboarding

export interface Onboarding {
  steps: { key: "profile" | "areas" | "schedule" | "bank" | "design"; label: string; done: boolean; href: string }[];
  done: number;
  total: number;
  /** Customers can book the artist (active + areas + specialties + hours). */
  bookable: boolean;
  missingForBookable: string[];
}

export async function getOnboarding(q: Queryable, artistId: string): Promise<Onboarding> {
  const r = (
    await q.query<{ status: string; profile: boolean; areas: boolean; services: boolean; schedule: boolean; bank: boolean; design: boolean; approved_design: boolean }>(
      `SELECT a.status,
              (length(a.bio) >= 40 AND a.photo_url IS NOT NULL) AS profile,
              EXISTS (SELECT 1 FROM artist_service_areas WHERE artist_id = a.id) AS areas,
              EXISTS (SELECT 1 FROM artist_services WHERE artist_id = a.id) AS services,
              EXISTS (SELECT 1 FROM artist_availability WHERE artist_id = a.id) AS schedule,
              EXISTS (SELECT 1 FROM artist_bank_accounts WHERE artist_id = a.id) AS bank,
              EXISTS (SELECT 1 FROM designs WHERE artist_id = a.id) AS design,
              EXISTS (SELECT 1 FROM designs WHERE artist_id = a.id AND review_status = 'approved' AND status = 'active') AS approved_design
       FROM artists a WHERE a.id = $1`,
      [artistId],
    )
  )[0];
  const steps: Onboarding["steps"] = [
    { key: "profile", label: "Add your photo and about you", done: !!r?.profile, href: "/artist-portal/profile#about" },
    { key: "areas", label: "Choose your service areas and specialties", done: !!(r?.areas && r?.services), href: "/artist-portal/profile#areas" },
    { key: "schedule", label: "Set your working days and hours", done: !!r?.schedule, href: "/artist-portal/schedule" },
    { key: "bank", label: "Add your bank account for payouts", done: !!r?.bank, href: "/artist-portal/payouts#bank" },
    { key: "design", label: "Upload your first design", done: !!r?.design, href: "/artist-portal/designs/new" },
  ];
  const missing: string[] = [];
  if (r?.status !== "active") missing.push("account approval");
  if (!r?.areas) missing.push("service areas");
  if (!r?.services) missing.push("specialties");
  if (!r?.schedule) missing.push("working hours");
  return { steps, done: steps.filter((s) => s.done).length, total: steps.length, bookable: missing.length === 0, missingForBookable: missing };
}

// ------------------------------------------------------------------ dashboard

export interface DashboardStats {
  month_orders: number;
  month_completed: number;
  month_gross_paise: number;
  month_net_paise: number;
  upcoming: number;
  awaiting_response: number;
  designs_live: number;
  designs_pending: number;
  rating: number | null;
  review_count: number;
}

export async function getDashboardStats(q: Queryable, artistId: string): Promise<DashboardStats> {
  // Calendar month in IST.
  return (
    await q.query<DashboardStats>(
      `WITH m AS (SELECT (date_trunc('month', (now() AT TIME ZONE 'UTC') + interval '330 minutes') - interval '330 minutes') AT TIME ZONE 'UTC' AS start)
       SELECT
         (SELECT count(*)::int FROM bookings b, m WHERE b.artist_id = $1 AND b.starts_at >= m.start
            AND b.status IN ('awaiting_artist_confirmation','confirmed','in_progress','completed')) AS month_orders,
         (SELECT count(*)::int FROM bookings b, m WHERE b.artist_id = $1 AND b.starts_at >= m.start AND b.status = 'completed') AS month_completed,
         (SELECT COALESCE(sum(l.gross_paise), 0)::int FROM artist_ledger l, m WHERE l.artist_id = $1 AND l.kind = 'booking' AND l.created_at >= m.start) AS month_gross_paise,
         (SELECT COALESCE(sum(l.gross_paise - l.margin_paise), 0)::int FROM artist_ledger l, m WHERE l.artist_id = $1 AND l.kind = 'booking' AND l.created_at >= m.start) AS month_net_paise,
         (SELECT count(*)::int FROM bookings b WHERE b.artist_id = $1 AND b.starts_at > now() AND b.status IN ('confirmed','in_progress')) AS upcoming,
         (SELECT count(*)::int FROM bookings b WHERE b.artist_id = $1 AND b.status = 'awaiting_artist_confirmation') AS awaiting_response,
         (SELECT count(*)::int FROM designs d WHERE d.artist_id = $1 AND d.review_status = 'approved' AND d.status = 'active') AS designs_live,
         (SELECT count(*)::int FROM designs d WHERE d.artist_id = $1 AND d.review_status = 'pending') AS designs_pending,
         (SELECT round(avg(r.rating)::numeric, 1)::float8 FROM reviews r WHERE r.artist_id = $1 AND r.status = 'published') AS rating,
         (SELECT count(*)::int FROM reviews r WHERE r.artist_id = $1 AND r.status = 'published') AS review_count`,
      [artistId],
    )
  )[0];
}

// ------------------------------------------------------------------ orders

export interface ArtistOrder {
  id: string;
  code: string;
  status: BookingStatus;
  starts_at: string;
  duration_minutes: number;
  people_count: number;
  design: string;
  locality: string;
  address_line: string | null;
  landmark: string | null;
  instructions: string | null;
  special_requirements: string;
  customer_first: string;
  customer_phone: string | null;
  total_paise: number;
  advance_paise: number;
  options: Record<string, unknown>;
  lat: number | null;
  lng: number | null;
}

export type OrderFilter = "requests" | "upcoming" | "past" | "all";

/** Assigned bookings. Address, instructions and phone are revealed only after the artist accepts. */
export async function listArtistOrders(q: Queryable, artistId: string, filter: OrderFilter): Promise<ArtistOrder[]> {
  const where: Record<OrderFilter, string> = {
    requests: `b.status = 'awaiting_artist_confirmation'`,
    upcoming: `b.status IN ('confirmed','in_progress')`,
    past: `b.status IN ('completed','cancelled','refund_pending','refunded')`,
    all: `b.status IN ('awaiting_artist_confirmation','confirmed','in_progress','completed','cancelled','refund_pending','refunded')`,
  };
  const order = filter === "past" ? "b.starts_at DESC" : "b.starts_at";
  return q.query<ArtistOrder>(
    `SELECT b.id, b.code, b.status, b.starts_at, b.duration_minutes, b.people_count, d.name AS design, l.name AS locality,
            CASE WHEN b.status IN ('confirmed','in_progress','completed') THEN b.address_line END AS address_line,
            CASE WHEN b.status IN ('confirmed','in_progress','completed') THEN b.landmark END AS landmark,
            CASE WHEN b.status IN ('confirmed','in_progress','completed') THEN b.instructions END AS instructions,
            b.special_requirements, split_part(c.name, ' ', 1) AS customer_first,
            CASE WHEN b.status IN ('confirmed','in_progress') THEN c.phone END AS customer_phone,
            b.total_paise, b.advance_paise, b.options,
            CASE WHEN b.status IN ('confirmed','in_progress','completed') THEN b.lat END AS lat,
            CASE WHEN b.status IN ('confirmed','in_progress','completed') THEN b.lng END AS lng
     FROM bookings b JOIN designs d ON d.id = b.design_id JOIN localities l ON l.id = b.locality_id JOIN customers c ON c.id = b.customer_id
     WHERE b.artist_id = $1 AND ${where[filter]}
     ORDER BY ${order} LIMIT 100`,
    [artistId],
  );
}

// ------------------------------------------------------------------ schedule

export interface ScheduleDay {
  weekday: number; // 0 = Sunday
  windows: { start: number; end: number }[];
}

export async function getSchedule(q: Queryable, artistId: string) {
  const rows = await q.query<{ weekday: number; start_minute: number; end_minute: number }>(
    `SELECT weekday, start_minute, end_minute FROM artist_availability WHERE artist_id = $1 ORDER BY weekday, start_minute`,
    [artistId],
  );
  const days: ScheduleDay[] = Array.from({ length: 7 }, (_, weekday) => ({ weekday, windows: [] }));
  for (const r of rows) days[r.weekday].windows.push({ start: r.start_minute, end: r.end_minute });
  const off = await q.query<{ id: string; lo: string; hi: string; reason: string }>(
    `SELECT id, lower(period) AS lo, upper(period) AS hi, reason FROM artist_time_off WHERE artist_id = $1 AND upper(period) > now() ORDER BY lower(period)`,
    [artistId],
  );
  return { days, timeOff: off };
}

/** Validates and replaces the weekly schedule (windows per weekday, no overlaps). */
export async function saveSchedule(q: Queryable, artistId: string, days: ScheduleDay[]) {
  for (const d of days) {
    const w = [...d.windows].sort((a, b) => a.start - b.start);
    for (let i = 0; i < w.length; i++) {
      if (w[i].end - w[i].start < 30) throw new Error("Each working window must be at least 30 minutes long.");
      if (i && w[i].start < w[i - 1].end) throw new Error("Working windows on the same day cannot overlap.");
    }
  }
  await q.query(`DELETE FROM artist_availability WHERE artist_id = $1`, [artistId]);
  for (const d of days)
    for (const w of d.windows)
      await q.query(`INSERT INTO artist_availability(artist_id, weekday, start_minute, end_minute) VALUES ($1,$2,$3,$4)`, [artistId, d.weekday, w.start, w.end]);
}

// ------------------------------------------------------------------ designs

export interface ArtistDesign {
  id: string;
  slug: string;
  name: string;
  category_slug: string;
  category_name: string;
  description: string;
  includes: string;
  region: "palm" | "back" | "palm_back" | "feet";
  complexity: "simple" | "moderate" | "intricate" | "bridal";
  duration_minutes: number;
  base_price_paise: number;
  video_url: string | null;
  status: "active" | "draft" | "unavailable";
  review_status: "pending" | "approved" | "rejected";
  review_note: string | null;
  submitted_at: string | null;
  /** An edit of the live design is waiting for review (the fields above show that edit). */
  has_pending: boolean;
  /** Gallery photos; `id` is the URL (stable across live and pending versions). */
  photos: { id: string; url: string }[];
  assets: Partial<Record<AssetKind, string>>;
  bookings: number;
}

const ARTIST_DESIGN_SELECT = `
  SELECT d.id, d.slug, d.name, d.category_slug, c.name AS category_name, d.description, d.includes, d.region, d.complexity,
         d.duration_minutes, d.base_price_paise, d.video_url, d.status, d.review_status, d.review_note, d.submitted_at,
         d.pending_changes, (d.pending_changes IS NOT NULL) AS has_pending,
         COALESCE((SELECT array_agg(p.url ORDER BY p.sort, p.created_at) FROM design_photos p WHERE p.design_id = d.id), '{}') AS photo_urls,
         COALESCE((SELECT jsonb_object_agg(a.kind, a.url) FROM design_assets a WHERE a.design_id = d.id), '{}'::jsonb) AS assets,
         (SELECT count(*)::int FROM bookings b WHERE b.design_id = d.id AND b.status NOT IN ('pending_payment','expired')) AS bookings
  FROM designs d JOIN design_categories c ON c.slug = d.category_slug`;

type Row = Omit<ArtistDesign, "photos"> & { pending_changes: DesignSnapshot | null; photo_urls: string[] };

/** Overlays a pending edit so the artist always sees (and edits) what they last submitted. */
function view(r: Row): ArtistDesign {
  const { pending_changes: pc, photo_urls, ...rest } = r;
  const base = pc ? { ...rest, ...pc, photos: pc.photos, assets: pc.assets } : { ...rest, photos: photo_urls };
  return { ...base, photos: base.photos.map((u) => ({ id: u, url: u })) } as ArtistDesign;
}

export async function listArtistDesigns(q: Queryable, artistId: string): Promise<ArtistDesign[]> {
  return (await q.query<Row>(`${ARTIST_DESIGN_SELECT} WHERE d.artist_id = $1 ORDER BY d.created_at DESC`, [artistId])).map(view);
}

export async function getArtistDesign(q: Queryable, artistId: string, id: string): Promise<ArtistDesign | null> {
  const r = (await q.query<Row>(`${ARTIST_DESIGN_SELECT} WHERE d.artist_id = $1 AND d.id = $2`, [artistId, id]))[0];
  return r ? view(r) : null;
}
