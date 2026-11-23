"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
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
        status: z.enum(["pending", "active", "suspended"]),
        verified: z.boolean(),
        verification_notes: z.string().max(500),
      })
      .parse({
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
      if (id) {
        await q.query(
          `UPDATE artists SET slug=$2, name=$3, phone=$4, bio=$5, instagram=$6, experience_years=$7, experience_verified=$8, skill_level=$9, status=$10,
             verification_notes=$11, verified_at = CASE WHEN $12 THEN COALESCE(verified_at, now()) ELSE NULL END, updated_at=now() WHERE id=$1`,
          [id, ...vals, data.verified],
        );
      } else {
        const r = await q.query<{ id: string }>(
          `INSERT INTO artists(slug, name, phone, bio, instagram, experience_years, experience_verified, skill_level, status, verification_notes, verified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11 THEN now() END) RETURNING id`,
          [...vals, data.verified],
        );
        id = r[0].id;
      }
      await q.query(`DELETE FROM artist_service_areas WHERE artist_id = $1`, [id]);
      for (const l of localities) await q.query(`INSERT INTO artist_service_areas VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, l]);
      await q.query(`DELETE FROM artist_services WHERE artist_id = $1`, [id]);
      for (const c of services) await q.query(`INSERT INTO artist_services VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, c]);
      // Weekly availability: one row per weekday with start/end (HH:MM, IST)
      await q.query(`DELETE FROM artist_availability WHERE artist_id = $1`, [id]);
      for (let wd = 0; wd < 7; wd++) {
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

export async function createArtistLoginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  try {
    const id = z.string().uuid().parse(s(form.get("artistId")));
    const email = z.string().email("Enter a valid email").parse(s(form.get("email")).toLowerCase());
    const password = z.string().min(10, "Temporary password must be at least 10 characters").parse(s(form.get("password")));
    const db = await getDb();
    await db.tx(async (q) => {
      const a = await q.query<{ name: string; user_id: string | null }>(`SELECT name, user_id FROM artists WHERE id = $1`, [id]);
      if (!a[0]) throw new BookingError("Artist not found");
      if (a[0].user_id) throw new BookingError("This artist already has a login.");
      const u = await q.query<{ id: string }>(`INSERT INTO users(email, name, password_hash, role) VALUES ($1,$2,$3,'artist') RETURNING id`, [email, a[0].name, hashPassword(password)]);
      await q.query(`UPDATE artists SET user_id = $2 WHERE id = $1`, [id, u[0].id]);
    });
    await audit(user.id, "artist_login_created", "artist", id, { email });
    revalidatePath(`/admin/artists/${id}`);
    return { ok: "Login created. Share the temporary password with the artist securely." };
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
