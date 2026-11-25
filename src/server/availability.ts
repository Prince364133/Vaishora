import "server-only";
import { Queryable } from "./db";
import { BusinessSettings } from "./settings";
import { addDays, istDateString, istToUtc, istWeekday } from "@/lib/time";
import { ACTIVE_HOLD_STATUSES } from "@/lib/booking-status";

// Availability is computed from real data only: active artists, their weekly hours,
// time off, service areas, specialties and existing bookings (with buffers).
// A slot is offered only if at least one eligible artist is genuinely free.

const SKILL_RANK = { standard: 0, senior: 1, bridal_specialist: 2 } as const;
type Skill = keyof typeof SKILL_RANK;

export interface SlotQuery {
  date: string; // IST YYYY-MM-DD
  durationMinutes: number;
  localityId: number;
  categorySlug: string;
  eligibility: Skill;
  /** Set for an artist's own design: only that artist can take it (their hours, areas and daily cap). */
  artistId?: string | null;
}

export interface Slot {
  start_minute: number;
  starts_at: string;
  ends_at: string;
  available: boolean;
  reason?: "past" | "booked" | "no_artist";
}

interface Candidate {
  id: string;
  windows: Array<{ start: number; end: number }>;
}

/** Expire unpaid holds whose payment window has closed, releasing their slots. */
export async function expireStaleHolds(q: Queryable) {
  const rows = await q.query<{ id: string }>(
    `UPDATE bookings SET status = 'expired', updated_at = now()
     WHERE status = 'pending_payment' AND hold_expires_at < now()
     RETURNING id`,
  );
  for (const r of rows) {
    await q.query(
      `INSERT INTO booking_status_history(booking_id, from_status, to_status, actor_type, note)
       VALUES ($1, 'pending_payment', 'expired', 'system', 'Payment window closed')`,
      [r.id],
    );
    await q.query(`UPDATE payments SET status = 'failed', failure_reason = 'expired', updated_at = now() WHERE booking_id = $1 AND status IN ('created', 'attempted')`, [r.id]);
  }
  return rows.length;
}

async function candidates(q: Queryable, s: SlotQuery, settings: BusinessSettings): Promise<Candidate[]> {
  const weekday = istWeekday(s.date);
  const own = !!s.artistId;
  // Platform designs: any active artist offering the category in the area. An artist's own design:
  // that artist only (the category is theirs by definition).
  const rows = await q.query<{ id: string; start_minute: number; end_minute: number; skill_level: Skill; max_per_day: number | null; day_count: number }>(
    `SELECT a.id, av.start_minute, av.end_minute, a.skill_level, a.max_bookings_per_day AS max_per_day,
            (SELECT count(*)::int FROM bookings b WHERE b.artist_id = a.id AND b.status = ANY($6::text[])
               AND ((b.starts_at AT TIME ZONE 'UTC') + interval '330 minutes')::date = $7::date) AS day_count
     FROM artists a
     JOIN artist_availability av ON av.artist_id = a.id AND av.weekday = $1
     JOIN artist_service_areas sa ON sa.artist_id = a.id AND sa.locality_id = $2
     WHERE a.status = 'active' AND (NOT a.is_demo OR $4)
       AND ${own ? "a.id = $5::uuid AND $3::text IS NOT NULL" : "$5::uuid IS NULL AND EXISTS (SELECT 1 FROM artist_services sv WHERE sv.artist_id = a.id AND sv.category_slug = $3::text)"}`,
    [weekday, s.localityId, s.categorySlug, settings.allow_demo_artists, s.artistId ?? null, ACTIVE_HOLD_STATUSES, s.date],
  );
  const map = new Map<string, Candidate>();
  for (const r of rows) {
    if (!own && SKILL_RANK[r.skill_level] < SKILL_RANK[s.eligibility]) continue;
    if (r.max_per_day != null && r.day_count >= r.max_per_day) continue; // fully booked that day
    const c = map.get(r.id) ?? { id: r.id, windows: [] };
    c.windows.push({ start: r.start_minute, end: r.end_minute });
    map.set(r.id, c);
  }
  return [...map.values()];
}

interface Busy {
  artist_id: string;
  lo: Date;
  hi: Date;
}

async function busyIntervals(q: Queryable, artistIds: string[], from: Date, to: Date): Promise<Busy[]> {
  if (!artistIds.length) return [];
  const rows = await q.query<{ artist_id: string; lo: string; hi: string }>(
    `SELECT artist_id, lower(block) AS lo, upper(block) AS hi FROM bookings
     WHERE artist_id = ANY($1::uuid[]) AND status = ANY($2::text[]) AND block && tstzrange($3, $4)
     UNION ALL
     SELECT artist_id, lower(period), upper(period) FROM artist_time_off
     WHERE artist_id = ANY($1::uuid[]) AND period && tstzrange($3, $4)`,
    [artistIds, ACTIVE_HOLD_STATUSES, from.toISOString(), to.toISOString()],
  );
  return rows.map((r) => ({ artist_id: r.artist_id, lo: new Date(r.lo), hi: new Date(r.hi) }));
}

export interface DaySlots {
  date: string;
  slots: Slot[];
  /** artist ids free for each start minute (server-side only) */
  free: Map<number, string[]>;
}

export async function computeDaySlots(q: Queryable, s: SlotQuery, settings: BusinessSettings, now = new Date()): Promise<DaySlots> {
  const today = istDateString(now);
  const lastDay = addDays(today, settings.booking_window_days);
  const free = new Map<number, string[]>();
  if (s.date < today || s.date > lastDay) return { date: s.date, slots: [], free };

  const cands = await candidates(q, s, settings);
  const buffer = settings.buffer_minutes * 60_000;
  const dayStart = istToUtc(s.date, 0);
  const dayEnd = istToUtc(s.date, 24 * 60);
  const busy = await busyIntervals(
    q,
    cands.map((c) => c.id),
    new Date(dayStart.getTime() - buffer - 6 * 3600_000),
    new Date(dayEnd.getTime() + buffer + 6 * 3600_000),
  );
  const earliest = now.getTime() + settings.lead_time_hours * 3600_000;
  const slots: Slot[] = [];

  for (let m = settings.service_start_minute; m + s.durationMinutes <= settings.service_end_minute; m += settings.slot_interval_minutes) {
    const start = istToUtc(s.date, m);
    const end = new Date(start.getTime() + s.durationMinutes * 60_000);
    const blockLo = start.getTime() - buffer;
    const blockHi = end.getTime() + buffer;
    const base = { start_minute: m, starts_at: start.toISOString(), ends_at: end.toISOString() };
    if (start.getTime() < earliest) {
      slots.push({ ...base, available: false, reason: "past" });
      continue;
    }
    const ok: string[] = [];
    let anyWorking = false;
    for (const c of cands) {
      if (!c.windows.some((w) => w.start <= m && w.end >= m + s.durationMinutes)) continue;
      anyWorking = true;
      const clash = busy.some((b) => b.artist_id === c.id && b.lo.getTime() < blockHi && b.hi.getTime() > blockLo);
      if (!clash) ok.push(c.id);
    }
    if (ok.length) {
      free.set(m, ok);
      slots.push({ ...base, available: true });
    } else {
      slots.push({ ...base, available: false, reason: anyWorking ? "booked" : "no_artist" });
    }
  }
  return { date: s.date, slots, free };
}
