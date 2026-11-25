"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { z } from "zod";
import { audit, login, logout, requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { transitionBooking, getBookingById, BookingError } from "@/server/bookings";
import { cancelWithRefund } from "@/server/payments/service";
import { setSetting, BusinessSettings } from "@/server/settings";
import { storeImage, UploadError } from "@/server/storage";
import { hashPassword } from "@/server/crypto";
import { BOOKING_STATUSES, BookingStatus, InvalidTransitionError } from "@/lib/booking-status";
import { rateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/auth";
import { queueEmail } from "@/server/email";
import { LedgerError, processPayout } from "@/server/ledger";
import { replyToTicket, TICKET_PRIORITIES, TICKET_STATUSES } from "@/server/support";
import { formatPaise } from "@/lib/money";
import { applySnapshot, DesignSnapshot } from "@/server/design-revisions";

export type ActionState = { ok?: string; error?: string; email?: string } | null;

const s = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const rupees = (v: FormDataEntryValue | null) => Math.round(Number(s(v) || "0") * 100);

function fail(e: unknown): ActionState {
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Invalid input" };
  if (e instanceof BookingError || e instanceof InvalidTransitionError || e instanceof UploadError) return { error: e.message };
  const pgErr = e as { code?: string; message?: string };
  if (pgErr?.code === "23505") return { error: "That value is already in use (must be unique)." };
  if (pgErr?.code === "23P01") return { error: "That artist already has an overlapping booking at this time." };
  if (pgErr?.code === "23514") return { error: "One of the values is out of the allowed range." };
  console.error("[admin]", e);
  return { error: (e as Error)?.message ?? "Something went wrong" };
}

// ------------------------------------------------------------------ auth
export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ip = await clientIp();
  if (!rateLimit(`login:${ip}`, 8, 15 * 60_000).ok) return { error: "Too many attempts. Try again in 15 minutes." };
  const user = await login(s(form.get("email")), s(form.get("password")));
  if (!user) return { error: "Email or password is incorrect.", email: s(form.get("email")) };
  await audit(user.id, "login", "user", user.id);
  redirect(user.role === "artist" ? "/artist-portal" : "/admin");
}

export async function logoutAction() {
  await logout();
  redirect("/admin/login");
}

export async function changePasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin", "staff", "artist"]);
  const pw = s(form.get("password"));
  if (pw.length < 10) return { error: "Use at least 10 characters." };
  const db = await getDb();
  await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [user.id, hashPassword(pw)]);
  await db.query(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);
  await audit(user.id, "password_changed", "user", user.id);
  redirect("/admin/login");
}

// ------------------------------------------------------------------ bookings
export async function changeBookingStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin", "staff"]);
  try {
    const id = z.string().uuid().parse(s(form.get("bookingId")));
    const to = z.enum(BOOKING_STATUSES).parse(s(form.get("status"))) as BookingStatus;
    const note = s(form.get("note")).slice(0, 300);
    if (["refund_pending", "refunded"].includes(to)) return { error: "Use the refund form to refund a booking." };
    const db = await getDb();
    await db.tx(async (q) => {
      const patch: { artist_id?: string | null } = {};
      if (to === "awaiting_artist_assignment") patch.artist_id = null;
      if (to === "awaiting_artist_confirmation" || to === "confirmed") {
        const row = await q.query<{ artist_id: string | null }>(`SELECT artist_id FROM bookings WHERE id = $1`, [id]);
        if (!row[0]?.artist_id) throw new BookingError("Assign an artist first.");
      }
      await transitionBooking(q, id, to, { type: "admin", id: user.id }, note, patch);
    });
    await audit(user.id, "booking_status", "booking", id, { to, note });
    revalidatePath(`/admin/bookings/${id}`);
    return { ok: "Status updated." };
  } catch (e) {
    return fail(e);
  }
}

export async function assignArtistAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin", "staff"]);
  try {
    const id = z.string().uuid().parse(s(form.get("bookingId")));
    const artistId = z.string().uuid().parse(s(form.get("artistId")));
    const db = await getDb();
    await db.tx(async (q) => {
      const b = (await q.query<{ status: BookingStatus }>(`SELECT status FROM bookings WHERE id = $1 FOR UPDATE`, [id]))[0];
      if (!b) throw new BookingError("Booking not found");
      const a = await q.query(`SELECT 1 FROM artists WHERE id = $1 AND status = 'active'`, [artistId]);
      if (!a.length) throw new BookingError("Artist is not active.");
      if (b.status === "awaiting_artist_assignment") {
        await transitionBooking(q, id, "awaiting_artist_confirmation", { type: "admin", id: user.id }, "Artist assigned", { artist_id: artistId });
      } else if (["awaiting_artist_confirmation", "confirmed", "pending_payment"].includes(b.status)) {
        // Reassignment: the exclusion constraint rejects overlaps with the new artist's bookings.
        await q.query(`UPDATE bookings SET artist_id = $2, updated_at = now() WHERE id = $1`, [id, artistId]);
        const next = b.status === "confirmed" ? "awaiting_artist_confirmation" : b.status;
        if (next !== b.status) await transitionBooking(q, id, next, { type: "admin", id: user.id }, "Artist reassigned; needs confirmation");
        else await q.query(`INSERT INTO booking_status_history(booking_id, from_status, to_status, actor_type, actor_id, note) VALUES ($1,$2,$2,'admin',$3,'Artist reassigned')`, [id, b.status, user.id]);
      } else throw new BookingError("Artists can only be assigned to upcoming bookings.");
    });
    await audit(user.id, "booking_assign", "booking", id, { artistId });
    revalidatePath(`/admin/bookings/${id}`);
    return { ok: "Artist assigned. Waiting for their confirmation." };
  } catch (e) {
    return fail(e);
  }
}

export async function refundBookingAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const id = z.string().uuid().parse(s(form.get("bookingId")));
    const amount = rupees(form.get("amount"));
    const reason = s(form.get("reason")).slice(0, 200) || "Refund issued by admin";
    const b = await getBookingById(id);
    if (!b) return { error: "Booking not found" };
    if (amount < 0 || amount > b.paid_paise - b.refunded_paise) return { error: "Refund cannot exceed the amount paid minus earlier refunds." };
    const r = await cancelWithRefund(id, amount, { type: "admin", id: user.id }, reason);
    await audit(user.id, "booking_refund", "booking", id, { amount, reason });
    revalidatePath(`/admin/bookings/${id}`);
    return { ok: r.refunded ? `Refund of ₹${r.refunded / 100} initiated.` : "Booking cancelled without refund." };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ designs
const designSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/, "Slug: 3–60 lowercase letters, numbers and dashes"),
  name: z.string().min(2).max(80),
  category_slug: z.string().min(1, "Choose a category"),
  description: z.string().max(600),
  region: z.enum(["palm", "back", "palm_back", "feet"]),
  complexity: z.enum(["simple", "moderate", "intricate", "bridal"]),
  duration_minutes: z.coerce.number().int().min(10, "Duration must be at least 10 minutes").max(600),
  base_price_paise: z.number().int().min(0).max(10_000_000),
  artist_eligibility: z.enum(["standard", "senior", "bridal_specialist"]),
  status: z.enum(["active", "draft", "unavailable"]),
  featured: z.boolean(),
  sort: z.coerce.number().int().min(0).max(9999),
});

export async function saveDesignAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  let id = s(form.get("id"));
  try {
    const d = designSchema.parse({
      slug: s(form.get("slug")),
      name: s(form.get("name")),
      category_slug: s(form.get("category_slug")),
      description: s(form.get("description")),
      region: s(form.get("region")),
      complexity: s(form.get("complexity")),
      duration_minutes: s(form.get("duration_minutes")),
      base_price_paise: rupees(form.get("price")),
      artist_eligibility: s(form.get("artist_eligibility")),
      status: s(form.get("status")),
      featured: form.get("featured") === "on",
      sort: s(form.get("sort")) || "0",
    });
    const db = await getDb();
    await db.tx(async (q) => {
      const vals = [d.slug, d.name, d.category_slug, d.description, d.region, d.complexity, d.duration_minutes, d.base_price_paise, d.artist_eligibility, d.status, d.featured, d.sort];
      if (id) {
        await q.query(
          `UPDATE designs SET slug=$2, name=$3, category_slug=$4, description=$5, region=$6, complexity=$7, duration_minutes=$8, base_price_paise=$9,
             artist_eligibility=$10, status=$11, featured=$12, sort=$13, updated_at=now() WHERE id=$1`,
          [id, ...vals],
        );
      } else {
        const r = await q.query<{ id: string }>(
          `INSERT INTO designs(slug, name, category_slug, description, region, complexity, duration_minutes, base_price_paise, artist_eligibility, status, featured, sort)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          vals,
        );
        id = r[0].id;
      }
      for (const kind of ["palm", "back", "feet"] as const) {
        const file = form.get(`art_${kind}`);
        if (file instanceof File && file.size > 0) {
          const url = await storeImage(file, "designs", { requireAlpha: true });
          await q.query(
            `INSERT INTO design_assets(design_id, kind, url, source) VALUES ($1,$2,$3,'upload')
             ON CONFLICT (design_id, kind) DO UPDATE SET url = EXCLUDED.url, source = 'upload', created_at = now()`,
            [id, kind, url],
          );
        }
      }
      const needed = d.region === "palm_back" ? ["palm", "back"] : [d.region];
      if (d.status === "active") {
        const have = await q.query<{ kind: string }>(`SELECT kind FROM design_assets WHERE design_id = $1`, [id]);
        const missing = needed.filter((k) => !have.some((h) => h.kind === k));
        if (missing.length) throw new BookingError(`Upload ${missing.join(" and ")} artwork before making this design active.`);
      }
    });
    await audit(user.id, "design_save", "design", id, { slug: d.slug, price: d.base_price_paise, status: d.status });
    updateTag("catalog");
  } catch (e) {
    return fail(e);
  }
  redirect(`/admin/designs?saved=${encodeURIComponent(s(form.get("name")))}`);
}

export async function saveCategoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const slug = z.string().regex(/^[a-z0-9-]{2,40}$/, "Slug: lowercase letters, numbers and dashes").parse(s(form.get("slug")));
    const name = z.string().min(2).max(60).parse(s(form.get("name")));
    const db = await getDb();
    await db.query(
      `INSERT INTO design_categories(slug, name, description, sort, active) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, sort=EXCLUDED.sort, active=EXCLUDED.active`,
      [slug, name, s(form.get("description")), Number(s(form.get("sort")) || 0), form.get("active") === "on"],
    );
    await audit(user.id, "category_save", "design_category", slug);
    updateTag("catalog");
    revalidatePath("/admin/designs");
    return { ok: "Category saved." };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ artists
export async function saveArtistAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  let id = s(form.get("id"));
  try {
    const data = z
      .object({
        slug: z.string().regex(/^[a-z0-9-]{3,60}$/, "Slug: 3–60 lowercase letters, numbers and dashes"),
        name: z.string().min(2).max(80),
        phone: z.string().regex(/^\+91[6-9]\d{9}$/, "Phone must look like +919876543210"),
        bio: z.string().max(800),
        instagram: z.string().max(120),
        experience_years: z.union([z.literal(""), z.coerce.number().int().min(0).max(60)]),
        experience_verified: z.boolean(),
        skill_level: z.enum(["standard", "senior", "bridal_specialist"]),
        status: z.enum(["pending", "active", "suspended", "rejected"]),
        verified: z.boolean(),
        verification_notes: z.string().max(500),
        email: z.union([z.literal(""), z.string().toLowerCase().email("Enter a valid sign-in email")]),
      })
      .parse({
        email: s(form.get("email")),
        slug: s(form.get("slug")),
        name: s(form.get("name")),
        phone: s(form.get("phone")),
        bio: s(form.get("bio")),
        instagram: s(form.get("instagram")),
        experience_years: s(form.get("experience_years")),
        experience_verified: form.get("experience_verified") === "on",
        skill_level: s(form.get("skill_level")),
        status: s(form.get("status")),
        verified: form.get("verified") === "on",
        verification_notes: s(form.get("verification_notes")),
      });
    const localities = form.getAll("localities").map((v) => Number(v)).filter(Number.isFinite);
    const services = form.getAll("services").map(String);
    const db = await getDb();
    await db.tx(async (q) => {
      const exp = data.experience_years === "" ? null : data.experience_years;
      const vals = [data.slug, data.name, data.phone, data.bio, data.instagram || null, exp, data.experience_verified, data.skill_level, data.status, data.verification_notes];
      const email = data.email || null;
      if (email) {
        const staff = await q.query(`SELECT 1 FROM users WHERE email = $1 AND role <> 'artist'`, [email]);
        if (staff.length) throw new BookingError("That email belongs to a staff account. Use the artist's own email.");
      }
      if (id) {
        // Changing the sign-in email unbinds the old 180 account so only the new email can sign in.
        await q.query(
          `UPDATE artists SET slug=$2, name=$3, phone=$4, bio=$5, instagram=$6, experience_years=$7, experience_verified=$8, skill_level=$9, status=$10,
             verification_notes=$11, verified_at = CASE WHEN $12 THEN COALESCE(verified_at, now()) ELSE NULL END,
             identity_sub = CASE WHEN email IS DISTINCT FROM $13 THEN NULL ELSE identity_sub END, email = $13, updated_at=now() WHERE id=$1`,
          [id, ...vals, data.verified, email],
        );
        const linked = (await q.query<{ user_id: string | null }>(`SELECT user_id FROM artists WHERE id = $1`, [id]))[0];
        if (linked?.user_id && email) await q.query(`UPDATE users SET email = $2 WHERE id = $1 AND role = 'artist'`, [linked.user_id, email]);
      } else {
        const r = await q.query<{ id: string }>(
          `INSERT INTO artists(slug, name, phone, bio, instagram, experience_years, experience_verified, skill_level, status, verification_notes, verified_at, email)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11 THEN now() END, $12) RETURNING id`,
          [...vals, data.verified, email],
        );
        id = r[0].id;
      }
      await q.query(`DELETE FROM artist_service_areas WHERE artist_id = $1`, [id]);
      for (const l of localities) await q.query(`INSERT INTO artist_service_areas VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, l]);
      await q.query(`DELETE FROM artist_services WHERE artist_id = $1`, [id]);
      for (const c of services) await q.query(`INSERT INTO artist_services VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, c]);
      // Weekly availability: one row per weekday with start/end (HH:MM, IST). Only when the form
      // offers it — artists with a portal account manage their own (possibly split) hours.
      if (form.has("manage_hours")) await q.query(`DELETE FROM artist_availability WHERE artist_id = $1`, [id]);
      for (let wd = 0; wd < 7 && form.has("manage_hours"); wd++) {
        if (form.get(`day_${wd}_on`) !== "on") continue;
        const toMin = (t: string) => {
          const m = /^(\d{1,2}):(\d{2})$/.exec(t);
          return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
        };
        const a = toMin(s(form.get(`day_${wd}_start`)));
        const b = toMin(s(form.get(`day_${wd}_end`)));
        if (!(a >= 0 && b > a && b <= 1440)) throw new BookingError("Each working day needs a start time before its end time.");
        await q.query(`INSERT INTO artist_availability(artist_id, weekday, start_minute, end_minute) VALUES ($1,$2,$3,$4)`, [id, wd, a, b]);
      }
      const photo = form.get("photo");
      if (photo instanceof File && photo.size > 0) {
        const url = await storeImage(photo, "portfolio");
        await q.query(`UPDATE artists SET photo_url = $2 WHERE id = $1`, [id, url]);
      }
      for (const f of form.getAll("portfolio")) {
        if (f instanceof File && f.size > 0) {
          const url = await storeImage(f, "portfolio");
          await q.query(`INSERT INTO artist_portfolios(artist_id, image_url, caption, sort) VALUES ($1,$2,'',(SELECT COALESCE(max(sort),0)+1 FROM artist_portfolios WHERE artist_id=$1))`, [id, url]);
        }
      }
    });
    await audit(user.id, "artist_save", "artist", id, { status: data.status, verified: data.verified });
    updateTag("artists");
  } catch (e) {
    return fail(e);
  }
  redirect(`/admin/artists/${id}?saved=1`);
}

export async function addTimeOffAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin", "staff"]);
  try {
    const id = z.string().uuid().parse(s(form.get("artistId")));
    const from = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(s(form.get("from")));
    const to = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(s(form.get("to")));
    if (to < from) return { error: "End date must be on or after the start date." };
    const db = await getDb();
    await db.query(
      `INSERT INTO artist_time_off(artist_id, period, reason) VALUES ($1, tstzrange(($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata', ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'), $4)`,
      [id, from, to, s(form.get("reason")).slice(0, 200)],
    );
    await audit(user.id, "artist_time_off", "artist", id, { from, to });
    revalidatePath(`/admin/artists/${id}`);
    return { ok: "Time off added." };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ pricing & settings
export async function saveRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const code = z.string().regex(/^[a-z0-9_]+$/).parse(s(form.get("code")));
    const pm = z.coerce.number().min(0).max(20).parse(s(form.get("price_multiplier")));
    const dm = z.coerce.number().min(0).max(20).parse(s(form.get("duration_multiplier")));
    const flat = rupees(form.get("flat"));
    const mins = z.coerce.number().int().min(0).max(600).parse(s(form.get("flat_minutes")) || "0");
    const label = z.string().min(2).max(60).parse(s(form.get("label")));
    const db = await getDb();
    await db.query(
      `UPDATE pricing_rules SET label=$2, description=$3, price_multiplier=$4, flat_paise=$5, duration_multiplier=$6, flat_minutes=$7, active=$8 WHERE code=$1`,
      [code, label, s(form.get("description")).slice(0, 200), pm, flat, dm, mins, form.get("active") === "on"],
    );
    await audit(user.id, "pricing_rule_save", "pricing_rule", code, { pm, flat, dm, mins });
    updateTag("catalog");
    revalidatePath("/admin/pricing");
    return { ok: `Saved “${label}”.` };
  } catch (e) {
    return fail(e);
  }
}

export async function saveSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const num = (k: string, min: number, max: number) => z.coerce.number().min(min).max(max).parse(s(form.get(k)));
    const values: Partial<BusinessSettings> = {
      gst_enabled: form.get("gst_enabled") === "on",
      gst_rate_bp: Math.round(num("gst_rate", 0, 28) * 100),
      advance_percent: num("advance_percent", 1, 100),
      platform_fee_paise: rupees(form.get("platform_fee")),
      buffer_minutes: num("buffer_minutes", 0, 240),
      lead_time_hours: num("lead_time_hours", 0, 168),
      slot_interval_minutes: num("slot_interval_minutes", 15, 120),
      hold_minutes: num("hold_minutes", 5, 60),
      booking_window_days: num("booking_window_days", 1, 365),
      service_start_minute: num("service_start_hour", 0, 23) * 60,
      service_end_minute: num("service_end_hour", 1, 24) * 60,
      allow_demo_artists: form.get("allow_demo_artists") === "on",
      cancellation: {
        full_refund_hours: num("full_refund_hours", 0, 720),
        partial_refund_hours: num("partial_refund_hours", 0, 720),
        partial_refund_percent: num("partial_refund_percent", 0, 100),
      },
      support: { phone: s(form.get("support_phone")), whatsapp: s(form.get("support_whatsapp")), email: s(form.get("support_email")), hours: s(form.get("support_hours")) },
    };
    if (values.cancellation!.partial_refund_hours > values.cancellation!.full_refund_hours) return { error: "Partial refund window must be shorter than the full refund window." };
    if (values.service_end_minute! <= values.service_start_minute!) return { error: "Service hours: end must be after start." };
    const db = await getDb();
    await db.tx(async (q) => {
      for (const [k, v] of Object.entries(values)) await setSetting(q, k as keyof BusinessSettings, v);
    });
    await audit(user.id, "settings_save", "settings", null, values);
    updateTag("catalog");
    updateTag("artists");
    revalidatePath("/admin/pricing");
    return { ok: "Settings saved." };
  } catch (e) {
    return fail(e);
  }
}

export async function saveCouponAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const code = z.string().regex(/^[A-Z0-9]{3,30}$/, "Code: 3–30 letters/numbers").parse(s(form.get("code")).toUpperCase());
    const kind = z.enum(["percent", "flat"]).parse(s(form.get("kind")));
    const value = kind === "percent" ? z.coerce.number().int().min(1).max(100).parse(s(form.get("value"))) : rupees(form.get("value"));
    if (value <= 0) return { error: "Enter a discount value." };
    const db = await getDb();
    await db.query(
      `INSERT INTO coupons(code, kind, value, min_order_paise, max_discount_paise, ends_at, usage_limit, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (code) DO UPDATE SET kind=EXCLUDED.kind, value=EXCLUDED.value, min_order_paise=EXCLUDED.min_order_paise, max_discount_paise=EXCLUDED.max_discount_paise,
         ends_at=EXCLUDED.ends_at, usage_limit=EXCLUDED.usage_limit, active=EXCLUDED.active`,
      [
        code, kind, value, rupees(form.get("min_order")),
        s(form.get("max_discount")) ? rupees(form.get("max_discount")) : null,
        s(form.get("ends_at")) ? `${s(form.get("ends_at"))}T23:59:59+05:30` : null,
        s(form.get("usage_limit")) ? Number(s(form.get("usage_limit"))) : null,
        form.get("active") === "on",
      ],
    );
    await audit(user.id, "coupon_save", "coupon", code, { kind, value });
    revalidatePath("/admin/pricing");
    return { ok: `Coupon ${code} saved.` };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ inbox
export async function updateInboxAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin", "staff"]);
  try {
    const table = z.enum(["support_requests", "artist_applications"]).parse(s(form.get("table")));
    const id = z.string().uuid().parse(s(form.get("id")));
    const status = s(form.get("status"));
    const allowed = table === "support_requests" ? ["open", "resolved"] : ["new", "contacted", "onboarded", "declined"];
    if (!allowed.includes(status)) return { error: "Invalid status" };
    const db = await getDb();
    await db.query(`UPDATE ${table} SET status = $2 WHERE id = $1`, [id, status]);
    await audit(user.id, `${table}_status`, table, id, { status });
    revalidatePath("/admin/customers");
    return { ok: "Updated." };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ artist portal
export async function artistRespondAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["artist"], "/admin/login");
  try {
    const id = z.string().uuid().parse(s(form.get("bookingId")));
    const decision = z.enum(["accept", "reject", "start", "complete"]).parse(s(form.get("decision")));
    const db = await getDb();
    await db.tx(async (q) => {
      const b = (await q.query<{ artist_id: string | null }>(`SELECT artist_id FROM bookings WHERE id = $1 FOR UPDATE`, [id]))[0];
      if (!b || !user.artist_id || b.artist_id !== user.artist_id) throw new BookingError("This booking is not assigned to you.");
      const map = {
        accept: ["confirmed", "Artist accepted"],
        reject: ["awaiting_artist_assignment", "Artist declined"],
        start: ["in_progress", "Artist started the session"],
        complete: ["completed", "Artist marked the session complete"],
      } as const;
      const [to, note] = map[decision];
      await transitionBooking(q, id, to, { type: "artist", id: user.id }, note, decision === "reject" ? { artist_id: null } : {});
    });
    await audit(user.id, `artist_${decision}`, "booking", id);
    revalidatePath("/artist-portal");
    return { ok: "Updated." };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ reviews
export async function moderateReviewAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin", "staff"]);
  try {
    const id = z.string().uuid().parse(s(form.get("id")));
    const status = z.enum(["published", "hidden", "pending"]).parse(s(form.get("status")));
    const db = await getDb();
    await db.query(`UPDATE reviews SET status = $2, moderated_by = $3, moderated_at = now() WHERE id = $1`, [id, status, user.id]);
    await audit(user.id, "review_moderate", "review", id, { status });
    revalidatePath("/admin/reviews");
    revalidatePath("/");
    return { ok: `Review ${status}.` };
  } catch (e) {
    return fail(e);
  }
}

/** Record a review genuinely received outside the site (Google, WhatsApp…), with evidence. */
export async function addExternalReviewAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const data = z
      .object({
        reviewer_name: z.string().min(2, "Enter the reviewer’s name as shown on the original review").max(60),
        rating: z.coerce.number().int().min(1).max(5),
        body: z.string().min(10, "Paste the review text exactly as written").max(1000),
        source: z.enum(["google", "whatsapp", "instagram", "facebook", "other"]),
        source_url: z.string().url("Enter a valid link").max(500).optional().or(z.literal("").transform(() => undefined)),
        evidence_note: z.string().max(300).optional().or(z.literal("").transform(() => undefined)),
        reviewed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
        consent: z.literal("on", { error: "Confirm the review is genuine and you may display it" }),
      })
      .parse(Object.fromEntries(["reviewer_name", "rating", "body", "source", "source_url", "evidence_note", "reviewed_on", "consent"].map((k) => [k, s(form.get(k))])));
    if (!data.source_url && !data.evidence_note) return { error: "Add a link to the original review or a note on where it is kept (e.g. WhatsApp screenshot saved)." };
    const db = await getDb();
    const r = await db.query<{ id: string }>(
      `INSERT INTO reviews(reviewer_name, rating, body, source, source_url, evidence_note, reviewed_on, status, added_by, moderated_by, moderated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'published',$8,$8,now()) RETURNING id`,
      [data.reviewer_name, data.rating, data.body, data.source, data.source_url ?? null, data.evidence_note ?? null, data.reviewed_on ?? null, user.id],
    );
    await audit(user.id, "review_add_external", "review", r[0].id, { source: data.source, source_url: data.source_url });
    revalidatePath("/admin/reviews");
    revalidatePath("/");
    return { ok: "Review added and published." };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ design from photo
const point = z.tuple([z.number().finite(), z.number().finite()]);
const landmarksSchema = z.array(point).length(21);
const captureSchema = z.object({
  source_w: z.coerce.number().int().min(16).max(8192),
  source_h: z.coerce.number().int().min(16).max(8192),
  landmarks: landmarksSchema,
  auto_landmarks: landmarksSchema.nullable(),
  landmarks_edited: z.boolean(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  frame_version: z.coerce.number().int().min(1).max(1000),
});
/** Extraction methods we record: the rule-based extractor or a version of the learned model. */
const methodSchema = z.string().regex(/^(heuristic-v1|unet-v\d{1,4})$/);
function jsonField(v: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(s(v) || "null");
  } catch {
    return undefined;
  }
}
/**
 * Creates a design from an uploaded mehndi photo. The browser (PhotoDesignImporter) has already
 * detected the hand, warped the photo onto our 3D hand frame and extracted the henna; this stores
 * the henna mask ('palm'/'back') and the fitted photo ('palm_photo'/'back_photo').
 */
export async function createDesignFromPhotoAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  let id = "";
  try {
    if (form.get("rights") !== "on") return { error: "Confirm you own the photo or have permission to use it." };
    const region = z.enum(["palm", "back"]).parse(s(form.get("region")));
    const d = designSchema.parse({
      slug: s(form.get("slug")),
      name: s(form.get("name")),
      category_slug: s(form.get("category_slug")),
      description: s(form.get("description")),
      region,
      complexity: s(form.get("complexity")),
      duration_minutes: s(form.get("duration_minutes")),
      base_price_paise: rupees(form.get("price")),
      artist_eligibility: "standard",
      status: s(form.get("status")) === "active" ? "active" : "draft",
      featured: false,
      sort: "0",
    });
    const mask = form.get(`art_${region}`);
    const photo = form.get(`photo_${region}`);
    if (!(mask instanceof File) || !mask.size || !(photo instanceof File) || !photo.size) return { error: "Process a photo first." };
    const cap = captureSchema.parse({
      source_w: s(form.get("source_w")),
      source_h: s(form.get("source_h")),
      landmarks: jsonField(form.get("landmarks")),
      auto_landmarks: jsonField(form.get("auto_landmarks")),
      landmarks_edited: s(form.get("landmarks_edited")) === "1",
      params: jsonField(form.get("params")),
      frame_version: s(form.get("frame_version")),
    });
    const source = form.get("source");
    if (!(source instanceof File) || !source.size) return { error: "The original photo is missing. Process the photo again." };
    const edits = form.get("edits");
    const sha256 = crypto.createHash("sha256").update(Buffer.from(await source.arrayBuffer())).digest("hex");
    const db = await getDb();
    await db.tx(async (q) => {
      const r = await q.query<{ id: string }>(
        `INSERT INTO designs(slug, name, category_slug, description, region, complexity, duration_minutes, base_price_paise, artist_eligibility, status, featured, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,0) RETURNING id`,
        [d.slug, d.name, d.category_slug, d.description, d.region, d.complexity, d.duration_minutes, d.base_price_paise, d.artist_eligibility, d.status],
      );
      id = r[0].id;
      // Keep the original photo, landmarks, parameters and brush layer: the design can then be rebuilt
      // for a new hand mesh, and (with consent) used to train better detection.
      const sourceUrl = await storeImage(source, "captures");
      const editsUrl = edits instanceof File && edits.size ? await storeImage(edits, "captures", { requireAlpha: true }) : null;
      const src = await q.query<{ id: string }>(
        `INSERT INTO capture_sources(design_id, side, photo_url, sha256, width, height, uploaded_by, rights_confirmed, consent_training)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8) RETURNING id`,
        [id, region, sourceUrl, sha256, cap.source_w, cap.source_h, user.id, form.get("consent_training") === "on"],
      );
      const maskUrl = await storeImage(mask, "designs", { requireAlpha: true });
      const photoUrl = await storeImage(photo, "designs", { requireAlpha: true });
      const unc = typeof cap.params.uncertainty === "number" ? Math.min(100, Math.max(0, cap.params.uncertainty)) : null;
      const run = await q.query<{ id: string }>(
        `INSERT INTO capture_runs(source_id, method, params, auto_landmarks, landmarks, landmarks_edited, edits_url, frame_version, created_by, uncertainty, mask_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [src[0].id, methodSchema.catch("heuristic-v1").parse(cap.params.method), JSON.stringify(cap.params), cap.auto_landmarks ? JSON.stringify(cap.auto_landmarks) : null, JSON.stringify(cap.landmarks), cap.landmarks_edited, editsUrl, cap.frame_version, user.id, unc, maskUrl],
      );
      await q.query(
        `INSERT INTO design_assets(design_id, kind, url, source, frame_version, capture_run_id) VALUES ($1,$2,$3,'upload',$6,$7), ($1,$4,$5,'upload',$6,$7)`,
        [id, region, maskUrl, `${region}_photo`, photoUrl, cap.frame_version, run[0].id],
      );
      const modelTex = form.get(`model_${region}`);
      if (modelTex instanceof File && modelTex.size) {
        const modelUrl = await storeImage(modelTex, "designs");
        await q.query(`INSERT INTO design_assets(design_id, kind, url, source, frame_version, capture_run_id) VALUES ($1,$2,$3,'upload',$4,$5)`, [
          id,
          region === "palm" ? "model_front" : "model_back",
          modelUrl,
          cap.frame_version,
          run[0].id,
        ]);
      }
    });
    await audit(user.id, "design_from_photo", "design", id, { slug: d.slug, region, status: d.status });
    updateTag("catalog");
  } catch (e) {
    return fail(e);
  }
  redirect(`/admin/designs/${id}?created=1`);
}

// ------------------------------------------------------------------ artist verification
export async function reviewArtistAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const id = z.string().uuid().parse(s(form.get("artistId")));
    const decision = z.enum(["approve", "reject", "suspend", "reactivate"]).parse(s(form.get("decision")));
    const reason = s(form.get("reason")).slice(0, 500);
    if ((decision === "reject" || decision === "suspend") && reason.length < 5) return { error: "Add a short reason — the artist will see it." };
    const db = await getDb();
    const a = (await db.query<{ status: string; email: string | null; name: string }>(`SELECT status, email, name FROM artists WHERE id = $1`, [id]))[0];
    if (!a) return { error: "Artist not found." };
    const allowed: Record<string, string[]> = { approve: ["pending", "rejected"], reject: ["pending"], suspend: ["active"], reactivate: ["suspended"] };
    if (!allowed[decision].includes(a.status)) return { error: `This artist is already ${a.status}.` };
    const next = { approve: "active", reject: "rejected", suspend: "suspended", reactivate: "active" }[decision];
    await db.query(
      `UPDATE artists SET status = $2, reviewed_by = $3, updated_at = now(),
         verified_at = CASE WHEN $2 = 'active' THEN COALESCE(verified_at, now()) ELSE verified_at END,
         rejection_reason = CASE WHEN $2 = 'rejected' THEN $4 ELSE NULL END,
         verification_notes = CASE WHEN $4 <> '' THEN $4 ELSE verification_notes END
       WHERE id = $1`,
      [id, next, user.id, reason],
    );
    await audit(user.id, `artist_${decision}`, "artist", id, { reason });
    const first = a.name.split(" ")[0];
    const mail = {
      approve: {
        subject: "You’re now an official VAISHORA artist",
        heading: `Welcome aboard, ${first}!`,
        paragraphs: [
          "Your artist account has been verified — you are now an official VAISHORA artist with full access to your artist portal.",
          "You can now list your mehndi designs and services with your own prices and timings, set your working days and hours, and start receiving bookings from customers.",
          "Every design you list is reviewed by our team before it goes live in the store, and you’ll get an email as soon as it’s published.",
          "Sign in on the VAISHORA website with this email address (secure 180 sign-in) and you’ll be taken straight to your portal.",
        ],
        cta: { label: "Open my artist portal", path: "/account?artist=1" },
      },
      reject: {
        subject: "Update on your VAISHORA artist application",
        heading: "About your application",
        paragraphs: ["Thank you for applying to VAISHORA. We are unable to approve your artist account right now.", `Reason: ${reason}`, "If you have questions or your details have changed, contact us from the artist portal."],
        cta: { label: "Contact support", path: "/artist-portal/support" },
      },
      suspend: {
        subject: "Your VAISHORA artist account is paused",
        heading: "Account paused",
        paragraphs: ["Your artist account has been paused and you will not receive new bookings for now.", `Reason: ${reason}`, "Please contact support to resolve this."],
        cta: { label: "Contact support", path: "/artist-portal/support" },
      },
      reactivate: {
        subject: "Your VAISHORA artist account is active again",
        heading: "Welcome back",
        paragraphs: ["Your artist account is active again and customers can book you."],
        cta: { label: "Open artist portal", path: "/artist-portal" },
      },
    }[decision];
    if (a.email) queueEmail({ to: a.email, template: `artist_${decision}`, artistId: id, ...mail });
    updateTag("artists");
    updateTag("catalog");
    revalidatePath("/admin/verification");
    revalidatePath(`/admin/artists/${id}`);
    return { ok: { approve: "Artist approved and notified by email.", reject: "Application rejected; the artist was notified.", suspend: "Artist suspended.", reactivate: "Artist reactivated." }[decision] };
  } catch (e) {
    return fail(e);
  }
}

export async function reviewDesignAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin", "staff"]);
  try {
    const id = z.string().uuid().parse(s(form.get("designId")));
    const decision = z.enum(["approve", "reject"]).parse(s(form.get("decision")));
    const note = s(form.get("note")).slice(0, 500);
    if (decision === "reject" && note.length < 5) return { error: "Tell the artist what to change." };
    const db = await getDb();
    const d = (
      await db.query<{ name: string; artist_id: string | null; email: string | null; review_status: string; pending_changes: DesignSnapshot | null }>(
        `SELECT d.name, d.artist_id, a.email, d.review_status, d.pending_changes FROM designs d LEFT JOIN artists a ON a.id = d.artist_id WHERE d.id = $1`,
        [id],
      )
    )[0];
    if (!d) return { error: "Design not found." };
    const isEdit = !!d.pending_changes;
    if (!isEdit && d.review_status !== "pending") return { error: `This design was already ${d.review_status}.` };
    const name = d.pending_changes?.name ?? d.name;
    await db.tx(async (q) => {
      if (isEdit) {
        if (decision === "approve") await applySnapshot(q, id, d.pending_changes!);
        // review_note on a live design means "your last edit was not approved" (shown to the artist).
        await q.query(`UPDATE designs SET pending_changes = NULL, pending_submitted_at = NULL, review_note = $2, reviewed_at = now(), reviewed_by = $3 WHERE id = $1`, [
          id,
          decision === "reject" ? note : null,
          user.id,
        ]);
      } else {
        await q.query(`UPDATE designs SET review_status = $2, review_note = $3, reviewed_at = now(), reviewed_by = $4, updated_at = now() WHERE id = $1`, [
          id,
          decision === "approve" ? "approved" : "rejected",
          note || null,
          user.id,
        ]);
      }
    });
    await audit(user.id, `design_${decision}`, "design", id, { note, edit: isEdit });
    if (d.email && d.artist_id) {
      const approved = decision === "approve";
      queueEmail({
        to: d.email,
        template: `design_${isEdit ? "edit_" : ""}${decision}`,
        artistId: d.artist_id,
        subject: approved ? (isEdit ? `Your changes to “${name}” are live` : `“${name}” is now live on VAISHORA`) : `Changes needed for “${name}”`,
        heading: approved ? (isEdit ? "Your changes are live" : "Your design is live") : "Please update your design",
        paragraphs: approved
          ? [isEdit ? `Your edit of “${name}” was approved and is now showing in the store.` : `“${name}” was approved and customers can now book it with you.`, ...(note ? [`Note from our team: ${note}`] : [])]
          : [
              isEdit
                ? `Your latest changes to “${name}” were not approved, so the store still shows the previous version:`
                : `Our team reviewed “${name}” and asked for a change before it can go live:`,
              note,
              "Edit the design in your portal and save — it comes back to us automatically.",
            ],
        cta: { label: approved ? "View my designs" : "Edit design", path: `/artist-portal/designs/${id}` },
      });
    }
    updateTag("catalog");
    revalidatePath("/admin/verification");
    return { ok: decision === "approve" ? (isEdit ? "Changes approved and live." : "Design approved and live.") : "Sent back to the artist with your note." };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ margins & payouts
export async function saveMarginSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const pct = z.coerce.number({ error: "Enter a margin %" }).min(0, "Margin cannot be negative").max(60, "Margin above 60% looks wrong").parse(s(form.get("margin_percent")));
    const min = rupees(form.get("payout_min"));
    if (min < 100 || min > 10_000_000) return { error: "Minimum payout must be between ₹1 and ₹1,00,000." };
    const db = await getDb();
    await db.tx(async (q) => {
      await setSetting(q, "platform_margin_bp", Math.round(pct * 100));
      await setSetting(q, "payout_min_paise", min);
    });
    await audit(user.id, "margin_settings_save", "settings", null, { margin_bp: Math.round(pct * 100), payout_min_paise: min });
    updateTag("catalog");
    revalidatePath("/admin/payouts");
    return { ok: `Platform margin set to ${pct}%. It applies to bookings completed from now on.` };
  } catch (e) {
    return fail(e);
  }
}

export async function setArtistMarginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const id = z.string().uuid().parse(s(form.get("artistId")));
    const raw = s(form.get("margin_percent"));
    const bp = raw === "" ? null : Math.round(z.coerce.number().min(0).max(60, "Margin above 60% looks wrong").parse(raw) * 100);
    await (await getDb()).query(`UPDATE artists SET margin_bp = $2, updated_at = now() WHERE id = $1`, [id, bp]);
    await audit(user.id, "artist_margin_set", "artist", id, { margin_bp: bp });
    revalidatePath(`/admin/artists/${id}`);
    revalidatePath("/admin/payouts");
    return { ok: bp == null ? "Uses the central platform margin." : `Margin override set to ${bp / 100}%.` };
  } catch (e) {
    return fail(e);
  }
}

export async function processPayoutAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const id = z.string().uuid().parse(s(form.get("payoutId")));
    const action = z.enum(["approve", "paid", "reject"]).parse(s(form.get("action")));
    const reference = s(form.get("reference")).slice(0, 80);
    const note = s(form.get("note")).slice(0, 300);
    if (action === "reject" && note.length < 5) return { error: "Add a reason for the artist." };
    const db = await getDb();
    const p = await db.tx((q) => processPayout(q, id, action, user.id, { reference, note }));
    await audit(user.id, `payout_${action}`, "payout", id, { reference, note });
    if (action !== "approve") {
      const a = (await db.query<{ email: string | null }>(`SELECT email FROM artists WHERE id = $1`, [p.artist_id]))[0];
      if (a?.email)
        queueEmail({
          to: a.email,
          template: `payout_${action}`,
          artistId: p.artist_id,
          subject: action === "paid" ? `Payout of ${formatPaise(p.amount_paise)} sent to your bank` : "Your payout request was not processed",
          heading: action === "paid" ? "Payout sent" : "Payout not processed",
          paragraphs:
            action === "paid"
              ? [`We have transferred ${formatPaise(p.amount_paise)} to your bank account.`, `Bank reference (UTR): ${reference}`, "Banks usually credit it within a few hours."]
              : [`Your payout request of ${formatPaise(p.amount_paise)} could not be processed and the amount is back in your balance.`, `Reason: ${note}`],
          cta: { label: "View payouts", path: "/artist-portal/payouts" },
        });
    }
    revalidatePath("/admin/payouts");
    return { ok: { approve: "Payout approved.", paid: "Marked as paid; the artist was emailed.", reject: "Payout rejected; amount returned to the artist’s balance." }[action] };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return fail(e);
  }
}

export async function verifyBankAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const id = z.string().uuid().parse(s(form.get("artistId")));
    const r = await (await getDb()).query(`UPDATE artist_bank_accounts SET verified_at = now(), verified_by = $2 WHERE artist_id = $1 RETURNING artist_id`, [id, user.id]);
    if (!r.length) return { error: "No bank account on file." };
    await audit(user.id, "artist_bank_verified", "artist", id);
    revalidatePath("/admin/payouts");
    revalidatePath(`/admin/artists/${id}`);
    return { ok: "Bank account marked verified." };
  } catch (e) {
    return fail(e);
  }
}

export async function ledgerAdjustmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const id = z.string().uuid().parse(s(form.get("artistId")));
    const amount = Math.round(z.coerce.number({ error: "Enter an amount" }).refine((v) => v !== 0, "Enter a non-zero amount").parse(s(form.get("amount"))) * 100);
    const note = z.string().min(5, "Explain the adjustment (the artist sees it)").max(200).parse(s(form.get("note")));
    await (await getDb()).query(`INSERT INTO artist_ledger(artist_id, kind, amount_paise, note, created_by) VALUES ($1, 'adjustment', $2, $3, $4)`, [id, amount, note, user.id]);
    await audit(user.id, "ledger_adjustment", "artist", id, { amount, note });
    revalidatePath(`/admin/artists/${id}`);
    revalidatePath("/admin/payouts");
    return { ok: "Adjustment recorded." };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ support tickets
export async function adminReplyTicketAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin", "staff"]);
  try {
    const id = z.string().uuid().parse(s(form.get("ticketId")));
    const status = z.enum(TICKET_STATUSES).optional().parse(s(form.get("status")) || undefined);
    const priority = z.enum(TICKET_PRIORITIES).optional().parse(s(form.get("priority")) || undefined);
    const body = s(form.get("body"));
    if (!body && !status && !priority) return { error: "Write a reply or change the status." };
    if (body.length > 3000) return { error: "Reply is too long." };
    const db = await getDb();
    const t = (
      await db.query<{ artist_id: string | null; customer_id: string | null; code: string; subject: string; email: string | null }>(
        `SELECT t.artist_id, t.customer_id, t.code, t.subject, COALESCE(a.email, c.email) AS email
         FROM support_tickets t LEFT JOIN artists a ON a.id = t.artist_id LEFT JOIN customers c ON c.id = t.customer_id WHERE t.id = $1`,
        [id],
      )
    )[0];
    if (!t) return { error: "Ticket not found." };
    await db.tx(async (q) => {
      if (body) await replyToTicket(q, id, { authorType: "admin", authorId: user.id, authorName: user.name, body, status });
      else if (status)
        await q.query(`UPDATE support_tickets SET status = $2, updated_at = now(), resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN now() ELSE NULL END WHERE id = $1`, [id, status]);
      if (priority) await q.query(`UPDATE support_tickets SET priority = $2 WHERE id = $1`, [id, priority]);
    });
    await audit(user.id, "ticket_update", "support_ticket", id, { status, priority, replied: !!body });
    if (t.email && (t.artist_id || t.customer_id) && (body || status === "resolved"))
      queueEmail({
        to: t.email,
        template: "ticket_reply",
        artistId: t.artist_id,
        subject: `[${t.code}] ${status === "resolved" ? "Resolved" : "New reply"}: ${t.subject}`,
        heading: status === "resolved" ? "Your ticket was resolved" : "VAISHORA support replied",
        paragraphs: body ? [body.slice(0, 1200)] : ["Our team marked your ticket as resolved. Reply in the portal if you still need help."],
        cta: { label: "Open ticket", path: t.artist_id ? `/artist-portal/support/${id}` : `/account/support/${id}` },
      });
    revalidatePath(`/admin/support/${id}`);
    revalidatePath("/admin/support");
    return { ok: body ? "Reply sent." : "Ticket updated." };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Rebuilds a photo-imported design's assets for the current hand mesh. The browser re-warps the stored
 * original photo with the stored landmarks and brush layer (admin/designs/reproject) and uploads the
 * result here; a new capture run is recorded so every asset stays traceable to its source.
 */
export async function reprojectDesignAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const runId = z.string().uuid().parse(s(form.get("run_id")));
    const frameVersion = z.coerce.number().int().min(1).max(1000).parse(s(form.get("frame_version")));
    const method = methodSchema.parse(s(form.get("method")) || "heuristic-v1");
    const mask = form.get("mask");
    const photo = form.get("photo");
    if (!(mask instanceof File) || !mask.size || !(photo instanceof File) || !photo.size) return { error: "Missing re-projected images." };
    const db = await getDb();
    let designId = "";
    await db.tx(async (q) => {
      const rows = await q.query<{ source_id: string; method: string; params: unknown; auto_landmarks: unknown; landmarks: unknown; landmarks_edited: boolean; edits_url: string | null; design_id: string | null; side: string; review_status: string; reviewed_by: string | null; reviewed_at: string | null }>(
        `SELECT r.source_id, r.method, r.params, r.auto_landmarks, r.landmarks, r.landmarks_edited, r.edits_url, s.design_id, s.side, r.review_status, r.reviewed_by, r.reviewed_at
           FROM capture_runs r JOIN capture_sources s ON s.id = r.source_id WHERE r.id = $1`,
        [runId],
      );
      const r = rows[0];
      if (!r || !r.design_id) throw new UploadError("This capture is no longer linked to a design.");
      designId = r.design_id;
      const maskUrl = await storeImage(mask, "designs", { requireAlpha: true });
      const photoUrl = await storeImage(photo, "designs", { requireAlpha: true });
      const unc = z.coerce.number().min(0).max(100).nullable().catch(null).parse(s(form.get("uncertainty")) || null);
      const run = await q.query<{ id: string }>(
        `INSERT INTO capture_runs(source_id, method, params, auto_landmarks, landmarks, landmarks_edited, edits_url, frame_version, created_by, uncertainty, mask_url, review_status, reviewed_by, reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [r.source_id, method, JSON.stringify({ ...(r.params as object), method }), r.auto_landmarks ? JSON.stringify(r.auto_landmarks) : null, JSON.stringify(r.landmarks), r.landmarks_edited, r.edits_url, frameVersion, user.id, unc, maskUrl, r.review_status, r.reviewed_by, r.reviewed_at],
      );
      const modelTex = form.get("model");
      const modelUrl = modelTex instanceof File && modelTex.size ? await storeImage(modelTex, "designs") : null;
      const kinds: [string, string][] = [[r.side, maskUrl], [`${r.side}_photo`, photoUrl]];
      if (modelUrl) kinds.push([r.side === "palm" ? "model_front" : "model_back", modelUrl]);
      for (const [kind, url] of kinds) {
        await q.query(
          `INSERT INTO design_assets(design_id, kind, url, source, frame_version, capture_run_id) VALUES ($1,$2,$3,'upload',$4,$5)
           ON CONFLICT (design_id, kind) DO UPDATE SET url = EXCLUDED.url, frame_version = EXCLUDED.frame_version, capture_run_id = EXCLUDED.capture_run_id`,
          [r.design_id, kind, url, frameVersion, run[0].id],
        );
      }
    });
    await audit(user.id, "design_reproject", "design", designId, { run: runId, frame_version: frameVersion });
    updateTag("catalog");
    return { ok: "Re-projected." };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Review queue decision on a capture's latest run: "approved" makes its final henna a training label
 * (exported only when the photo owner consented), "rejected" keeps it out, "pending" undoes the decision.
 */
export async function reviewCaptureAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const runId = z.string().uuid().parse(s(form.get("run_id")));
    const status = z.enum(["approved", "rejected", "pending"]).parse(s(form.get("status")));
    const db = await getDb();
    const rows = await db.query<{ id: string }>(
      `UPDATE capture_runs SET review_status = $2, reviewed_by = CASE WHEN $2 = 'pending' THEN NULL ELSE $3::uuid END,
              reviewed_at = CASE WHEN $2 = 'pending' THEN NULL ELSE now() END
        WHERE id = $1 RETURNING id`,
      [runId, status, user.id],
    );
    if (!rows.length) return { error: "Capture not found." };
    await audit(user.id, "capture_review", "capture_run", runId, { status });
    revalidatePath("/admin/designs/captures");
    return { ok: status === "approved" ? "Approved as a training label." : status === "rejected" ? "Rejected." : "Back in the queue." };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ localities (Google Maps)
export async function syncLocalitiesAction(): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const { geocodeLocalities, mapsConfigured } = await import("@/server/maps");
    if (!mapsConfigured()) return { error: "Set GOOGLE_MAPS_API_KEY first." };
    const db = await getDb();
    await db.query(`UPDATE localities SET geocoded_at = NULL WHERE lat IS NULL`);
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const n = await geocodeLocalities(db, 40);
      total += n;
      if (!n) break;
    }
    const left = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM localities WHERE lat IS NULL`))[0].n;
    await audit(user.id, "localities_sync", "locality", null, { located: total, left });
    revalidatePath("/admin/pricing");
    return { ok: `Located ${total} localities on Google Maps.${left ? ` ${left} could not be found — check their names.` : ""}` };
  } catch (e) {
    return fail(e);
  }
}
