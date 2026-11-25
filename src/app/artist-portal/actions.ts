"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, logout } from "@/server/auth";
import { getDb } from "@/server/db";
import { ArtistAccessError, artistForAction } from "@/server/artist-auth";
import { saveSchedule, uniqueDesignSlug } from "@/server/artist-portal";
import { transitionBooking, BookingError } from "@/server/bookings";
import { LedgerError, requestPayout } from "@/server/ledger";
import { createTicket, replyToTicket, TICKET_CATEGORIES, TICKET_PRIORITIES } from "@/server/support";
import { storeImage, UploadError } from "@/server/storage";
import { encryptField } from "@/server/vault";
import { notifyTeam, queueEmail } from "@/server/email";
import { InvalidTransitionError } from "@/lib/booking-status";
import { phoneSchema } from "@/lib/schemas";
import { youTubeId } from "@/lib/youtube";
import { applySnapshot, ASSET_KINDS, currentSnapshot, DesignSnapshot } from "@/server/design-revisions";
import { recordCapture } from "@/server/captures";
import { FRAME_VERSION } from "@/lib/photo-import/warp";
import { localityFromPlace, MapsError } from "@/server/maps";
import type { ActionState } from "@/app/admin/actions";

const s = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const rupees = (v: FormDataEntryValue | null) => Math.round(Number(s(v) || "0") * 100);
const files = (form: FormData, name: string) => form.getAll(name).filter((f): f is File => f instanceof File && f.size > 0);

function fail(e: unknown): ActionState {
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Please check the form." };
  if (e instanceof ArtistAccessError || e instanceof BookingError || e instanceof InvalidTransitionError || e instanceof UploadError || e instanceof LedgerError)
    return { error: e.message };
  const pg = e as { code?: string; message?: string };
  if (pg?.code === "23505") return { error: "That value is already in use." };
  if (pg?.code === "23514") return { error: "One of the values is out of the allowed range." };
  if (e instanceof Error && /^(Each working window|Working windows)/.test(e.message)) return { error: e.message };
  console.error("[artist-portal]", e);
  return { error: "Something went wrong. Please try again." };
}

function refreshPublic() {
  updateTag("artists");
  updateTag("catalog");
}

// ------------------------------------------------------------------ session
export async function artistSignOutAction() {
  await logout();
  redirect("/"); // back to the website
}

// ------------------------------------------------------------------ profile
export async function saveProfileAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction();
    const p = z
      .object({
        name: z.string().min(2, "Enter your name").max(80),
        phone: phoneSchema,
        bio: z.string().max(1200, "About you can be up to 1200 characters"),
        instagram: z.string().max(200).refine((v) => !v || /^(@?[A-Za-z0-9._]{1,30}|https?:\/\/\S+)$/.test(v), "Enter an Instagram handle (@name) or a link"),
        experience_years: z.union([z.literal(""), z.coerce.number().int().min(0).max(60)]),
        languages: z.string().max(120),
      })
      .parse(Object.fromEntries(["name", "phone", "bio", "instagram", "experience_years", "languages"].map((k) => [k, s(form.get(k))])));
    const photo = files(form, "photo")[0];
    const db = await getDb();
    const photoUrl = photo ? await storeImage(photo, "artists") : null;
    const cur = (await db.query<{ experience_years: number | null }>(`SELECT experience_years FROM artists WHERE id = $1`, [a.id]))[0];
    const years = p.experience_years === "" ? null : p.experience_years;
    await db.query(
      `UPDATE artists SET name = $2, phone = $3, bio = $4, instagram = $5, experience_years = $6, languages = $7,
         photo_url = COALESCE($8, photo_url),
         experience_verified = CASE WHEN $6 IS DISTINCT FROM $9::int THEN false ELSE experience_verified END,
         updated_at = now() WHERE id = $1`,
      [a.id, p.name, p.phone, p.bio, p.instagram || null, years, p.languages, photoUrl, cur?.experience_years ?? null],
    );
    await db.query(`UPDATE users SET name = $2 WHERE id = $1`, [a.user_id, p.name]);
    await audit(a.user_id, "artist_profile_save", "artist", a.id, { photo: !!photoUrl });
    refreshPublic();
    revalidatePath("/artist-portal", "layout");
    return { ok: "Profile saved." };
  } catch (e) {
    return fail(e);
  }
}

export async function saveAreasAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction();
    const localities = z.array(z.coerce.number().int().positive()).max(80).parse(form.getAll("localities").map(String));
    const services = z.array(z.string().regex(/^[a-z0-9-]+$/)).max(30).parse(form.getAll("services").map(String));
    const cap = s(form.get("max_bookings_per_day"));
    const max = cap ? z.coerce.number().int().min(1, "Daily limit must be at least 1").max(20).parse(cap) : null;
    if (!localities.length) return { error: "Choose at least one area you can travel to." };
    if (!services.length) return { error: "Choose at least one specialty." };
    const db = await getDb();
    await db.tx(async (q) => {
      await q.query(`DELETE FROM artist_service_areas WHERE artist_id = $1`, [a.id]);
      await q.query(
        `INSERT INTO artist_service_areas(artist_id, locality_id) SELECT $1, id FROM localities WHERE id = ANY($2::int[]) AND active`,
        [a.id, localities],
      );
      await q.query(`DELETE FROM artist_services WHERE artist_id = $1`, [a.id]);
      await q.query(
        `INSERT INTO artist_services(artist_id, category_slug) SELECT $1, slug FROM design_categories WHERE slug = ANY($2::text[]) AND active`,
        [a.id, services],
      );
      await q.query(`UPDATE artists SET max_bookings_per_day = $2, updated_at = now() WHERE id = $1`, [a.id, max]);
    });
    await audit(a.user_id, "artist_areas_save", "artist", a.id, { localities: localities.length, services, max });
    refreshPublic();
    revalidatePath("/artist-portal", "layout");
    return { ok: "Service areas and specialties saved." };
  } catch (e) {
    return fail(e);
  }
}

/** Adds a real Hyderabad area (picked from Google Maps) to the artist's service areas. */
export async function addServiceAreaAction(placeId: string, session?: string): Promise<{ ok?: string; error?: string; locality?: { id: number; name: string } }> {
  try {
    const a = await artistForAction();
    z.string().min(10).max(300).parse(placeId);
    const db = await getDb();
    const loc = await db.tx(async (q) => {
      const l = await localityFromPlace(q, placeId, session);
      await q.query(`INSERT INTO artist_service_areas(artist_id, locality_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [a.id, l.id]);
      return l;
    });
    await audit(a.user_id, "artist_area_add", "artist", a.id, { locality: loc.name });
    refreshPublic();
    revalidatePath("/artist-portal", "layout");
    return { ok: `${loc.name} added to your service areas.`, locality: loc };
  } catch (e) {
    if (e instanceof MapsError) return { error: e.message };
    return fail(e) ?? { error: "Something went wrong." };
  }
}

export async function addPortfolioAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction();
    const imgs = files(form, "images");
    if (!imgs.length) return { error: "Choose at least one photo." };
    const db = await getDb();
    const count = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM artist_portfolios WHERE artist_id = $1`, [a.id]))[0].n;
    if (count + imgs.length > 24) return { error: "Your portfolio can hold up to 24 photos. Remove some first." };
    const caption = s(form.get("caption")).slice(0, 120);
    let sort = count;
    for (const f of imgs) {
      const url = await storeImage(f, "portfolio");
      await db.query(`INSERT INTO artist_portfolios(artist_id, image_url, caption, sort) VALUES ($1,$2,$3,$4)`, [a.id, url, caption, sort++]);
    }
    refreshPublic();
    revalidatePath("/artist-portal/profile");
    return { ok: `${imgs.length} photo${imgs.length > 1 ? "s" : ""} added.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removePortfolioAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction();
    const id = z.string().uuid().parse(s(form.get("id")));
    await (await getDb()).query(`DELETE FROM artist_portfolios WHERE id = $1 AND artist_id = $2`, [id, a.id]);
    refreshPublic();
    revalidatePath("/artist-portal/profile");
    return { ok: "Removed." };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ schedule
const scheduleSchema = z
  .array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      windows: z.array(z.object({ start: z.number().int().min(0).max(1440), end: z.number().int().min(0).max(1440) }).refine((w) => w.end > w.start, "End time must be after start time")).max(3),
    }),
  )
  .length(7);

export async function saveScheduleAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction();
    const days = scheduleSchema.parse(JSON.parse(s(form.get("schedule")) || "[]"));
    const db = await getDb();
    await db.tx((q) => saveSchedule(q, a.id, days));
    await audit(a.user_id, "artist_schedule_save", "artist", a.id, { days: days.filter((d) => d.windows.length).length });
    revalidatePath("/artist-portal", "layout");
    return { ok: "Working hours saved. Customers now see slots only within these hours." };
  } catch (e) {
    if (e instanceof SyntaxError) return { error: "Could not read the schedule. Please try again." };
    return fail(e);
  }
}

export async function addTimeOffAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction();
    const from = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date").parse(s(form.get("from")));
    const to = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end date").parse(s(form.get("to")) || from);
    if (to < from) return { error: "The end date must be on or after the start date." };
    const reason = s(form.get("reason")).slice(0, 120);
    const db = await getDb();
    // Whole IST days: from 00:00 on the first day to 24:00 on the last.
    await db.query(
      `INSERT INTO artist_time_off(artist_id, period, reason) VALUES ($1, tstzrange(($2 || 'T00:00:00+05:30')::timestamptz, (($3::date + 1)::text || 'T00:00:00+05:30')::timestamptz), $4)`,
      [a.id, from, to, reason],
    );
    await audit(a.user_id, "artist_time_off_add", "artist", a.id, { from, to });
    revalidatePath("/artist-portal/schedule");
    return { ok: "Days blocked. No new bookings will be offered on these dates." };
  } catch (e) {
    return fail(e);
  }
}

export async function removeTimeOffAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction();
    const id = z.string().uuid().parse(s(form.get("id")));
    await (await getDb()).query(`DELETE FROM artist_time_off WHERE id = $1 AND artist_id = $2`, [id, a.id]);
    revalidatePath("/artist-portal/schedule");
    return { ok: "Removed." };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ designs
const designSchema = z.object({
  name: z.string().min(3, "Give the design a name").max(80),
  category_slug: z.string().regex(/^[a-z0-9-]+$/, "Choose a category"),
  description: z.string().min(20, "Describe the design in at least 20 characters").max(1500),
  includes: z.string().max(300),
  region: z.enum(["palm", "back", "palm_back", "feet"], { error: "Choose where the design goes" }),
  complexity: z.enum(["simple", "moderate", "intricate", "bridal"], { error: "Choose the detail level" }),
  duration_minutes: z.coerce.number().int().min(15, "Duration must be at least 15 minutes").max(600, "Duration can be at most 10 hours"),
  price_paise: z.number().int().min(10_000, "Price must be at least ₹100").max(50_000_00, "Price looks too high"),
  video_url: z.string().max(300).refine((v) => !v || !!youTubeId(v), "Paste a YouTube link (youtube.com or youtu.be)"),
});

/**
 * Create or edit a design. Everything an artist submits is reviewed before it reaches the store:
 * new designs go live on approval; an edit of a live design waits as a snapshot while the live version
 * keeps selling, and replaces it on approval.
 */
export async function saveArtistDesignAction(_: ActionState, form: FormData): Promise<ActionState> {
  let target = "";
  try {
    const a = await artistForAction({ active: true });
    const id = s(form.get("id"));
    const d = designSchema.parse({
      name: s(form.get("name")),
      category_slug: s(form.get("category_slug")),
      description: s(form.get("description")),
      includes: s(form.get("includes")),
      region: s(form.get("region")),
      complexity: s(form.get("complexity")),
      duration_minutes: s(form.get("duration_minutes")),
      price_paise: rupees(form.get("price")),
      video_url: s(form.get("video_url")),
    });
    const newPhotos = files(form, "photos");
    const removePhotos = new Set(form.getAll("remove_photo").map(String));
    const db = await getDb();
    const cat = await db.query(`SELECT 1 FROM design_categories WHERE slug = $1 AND active`, [d.category_slug]);
    if (!cat.length) return { error: "Choose a category." };

    const existing = id
      ? (await db.query<{ id: string; review_status: string }>(`SELECT id, review_status FROM designs WHERE id = $1 AND artist_id = $2`, [id, a.id]))[0]
      : null;
    if (id && !existing) return { error: "Design not found." };
    const base = existing ? await currentSnapshot(db, existing.id) : null;
    const coverFile = files(form, "cover")[0];
    const coverPick = s(form.get("cover_photo"));
    let kept = (base?.photos ?? []).filter((u) => !removePhotos.has(u));
    // An existing photo chosen as cover moves to the front.
    if (!coverFile && coverPick && kept.includes(coverPick)) kept = [coverPick, ...kept.filter((u) => u !== coverPick)];
    const total = kept.length + newPhotos.length + (coverFile ? 1 : 0);
    if (!coverFile && !kept.length) return { error: "Add a cover image for this design." };
    if (total > 8) return { error: "A design can have up to 8 photos, including the cover." };

    // 3D preview made in the browser from a photo (henna mask + fitted hand photo per side).
    const assets = { ...(base?.assets ?? {}) };
    if (s(form.get("remove_3d")) === "1") for (const k of ASSET_KINDS) delete assets[k];
    let captureSide: "palm" | "back" | null = null;
    for (const side of ["palm", "back"] as const) {
      const art = files(form, `art_${side}`)[0];
      const photo = files(form, `photo_${side}`)[0];
      if (art && photo) {
        assets[side] = await storeImage(art, "designs", { requireAlpha: true });
        assets[`${side}_photo`] = await storeImage(photo, "designs", { requireAlpha: true });
        // the same design painted on the 3D model's photographed hands (what customers see)
        const model = files(form, `model_${side === "palm" ? "front" : "back"}`)[0];
        if (model) assets[side === "palm" ? "model_front" : "model_back"] = await storeImage(model, "designs");
        else delete assets[side === "palm" ? "model_front" : "model_back"];
        captureSide = side;
      }
    }
    const urls: string[] = [];
    for (const f of newPhotos) urls.push(await storeImage(f, "designs"));
    const coverUrl = coverFile ? await storeImage(coverFile, "designs") : null;

    const snap: DesignSnapshot = {
      name: d.name,
      category_slug: d.category_slug,
      description: d.description,
      includes: d.includes,
      region: d.region,
      complexity: d.complexity,
      duration_minutes: d.duration_minutes,
      base_price_paise: d.price_paise,
      video_url: d.video_url || null,
      photos: coverUrl ? [coverUrl, ...kept, ...urls] : [...kept, ...urls], // first = cover (card image)
      assets,
    };
    const live = existing?.review_status === "approved";
    const designId = await db.tx(async (q) => {
      if (!existing) {
        const slug = await uniqueDesignSlug(q, d.name, a.slug);
        const r = await q.query<{ id: string }>(
          `INSERT INTO designs(slug, name, category_slug, description, region, complexity, duration_minutes, base_price_paise,
             artist_eligibility, status, artist_id, review_status, submitted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'standard','active',$9,'pending',now()) RETURNING id`,
          [slug, d.name, d.category_slug, d.description, d.region, d.complexity, d.duration_minutes, d.price_paise, a.id],
        );
        await applySnapshot(q, r[0].id, snap);
        return r[0].id;
      }
      if (live) {
        await q.query(`UPDATE designs SET pending_changes = $2::jsonb, pending_submitted_at = now(), review_note = NULL, updated_at = now() WHERE id = $1`, [
          existing.id,
          JSON.stringify(snap),
        ]);
      } else {
        await applySnapshot(q, existing.id, snap);
        await q.query(`UPDATE designs SET review_status = 'pending', submitted_at = now(), review_note = NULL WHERE id = $1`, [existing.id]);
      }
      return existing.id;
    });
    // The photo used for the 3D preview goes to the admin review queue (and, if the artist opted in, teaches the
    // henna detector). Never blocks saving the design.
    const captureSource = files(form, "capture_source")[0];
    if (captureSide && captureSource && assets[captureSide]) {
      try {
        await recordCapture(db, {
          designId,
          uploadedBy: a.user_id,
          source: captureSource,
          landmarksJson: s(form.get("capture_landmarks")),
          paramsJson: s(form.get("capture_params")),
          maskUrl: assets[captureSide] as string,
          frameVersion: FRAME_VERSION,
          consentTraining: form.get("consent_training") === "on",
        });
      } catch (e) {
        console.warn("capture not recorded", e);
      }
    }
    await audit(a.user_id, existing ? "artist_design_update" : "artist_design_create", "design", designId, { live_edit: live });
    notifyTeam({
      template: "design_review",
      artistId: a.id,
      subject: `${live ? "Design edit" : "New design"} to review: ${d.name}`,
      heading: live ? "An artist edited a live design" : "A new design is waiting for review",
      paragraphs: [`${a.name} submitted “${d.name}” (₹${(d.price_paise / 100).toLocaleString("en-IN")}, ${d.duration_minutes} min).`],
      path: "/admin/verification?tab=designs",
    });
    revalidatePath("/artist-portal/designs");
    revalidatePath("/admin/verification");
    target = `/artist-portal/designs/${designId}?${!existing ? "submitted=1" : "review=1"}`;
  } catch (e) {
    return fail(e);
  }
  redirect(target);
}

/** Withdraws an edit that is still waiting for review (the live version is unchanged). */
export async function discardPendingEditAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction({ active: true });
    const id = z.string().uuid().parse(s(form.get("id")));
    const r = await (await getDb()).query(`UPDATE designs SET pending_changes = NULL, pending_submitted_at = NULL WHERE id = $1 AND artist_id = $2 RETURNING id`, [id, a.id]);
    if (!r.length) return { error: "Design not found." };
    revalidatePath(`/artist-portal/designs/${id}`);
    revalidatePath("/admin/verification");
    return { ok: "Edit withdrawn. The live version is unchanged." };
  } catch (e) {
    return fail(e);
  }
}

export async function setDesignAvailabilityAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction({ active: true });
    const id = z.string().uuid().parse(s(form.get("id")));
    const status = z.enum(["active", "unavailable"]).parse(s(form.get("status")));
    const r = await (await getDb()).query(`UPDATE designs SET status = $3, updated_at = now() WHERE id = $1 AND artist_id = $2 RETURNING id`, [id, a.id, status]);
    if (!r.length) return { error: "Design not found." };
    refreshPublic();
    revalidatePath("/artist-portal/designs");
    return { ok: status === "active" ? "Design is live in the store." : "Design hidden from the store. Turn it live again any time." };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDesignAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction({ active: true });
    const id = z.string().uuid().parse(s(form.get("id")));
    const db = await getDb();
    const used = await db.query(`SELECT 1 FROM bookings WHERE design_id = $1 LIMIT 1`, [id]);
    if (used.length) {
      // Bookings reference it: keep the record, just take it off the site.
      await db.query(`UPDATE designs SET status = 'draft', updated_at = now() WHERE id = $1 AND artist_id = $2`, [id, a.id]);
    } else {
      await db.query(`DELETE FROM designs WHERE id = $1 AND artist_id = $2`, [id, a.id]);
    }
    await audit(a.user_id, "artist_design_delete", "design", id, { archived: used.length > 0 });
    refreshPublic();
  } catch (e) {
    return fail(e);
  }
  redirect("/artist-portal/designs?deleted=1");
}

// ------------------------------------------------------------------ orders
export async function respondToOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  let target = "";
  try {
    const a = await artistForAction({ active: true });
    const id = z.string().uuid().parse(s(form.get("bookingId")));
    const decision = z.enum(["accept", "reject", "start", "complete"]).parse(s(form.get("decision")));
    const db = await getDb();
    await db.tx(async (q) => {
      const b = (await q.query<{ artist_id: string | null }>(`SELECT artist_id FROM bookings WHERE id = $1 FOR UPDATE`, [id]))[0];
      if (!b || b.artist_id !== a.id) throw new BookingError("This booking is not assigned to you.");
      const map = {
        accept: ["confirmed", "Artist accepted"],
        reject: ["awaiting_artist_assignment", "Artist declined"],
        start: ["in_progress", "Artist started the session"],
        complete: ["completed", "Artist marked the session complete"],
      } as const;
      const [to, note] = map[decision];
      await transitionBooking(q, id, to, { type: "artist", id: a.user_id }, note, decision === "reject" ? { artist_id: null } : {});
    });
    await audit(a.user_id, `artist_${decision}`, "booking", id);
    revalidatePath("/artist-portal", "layout");
    // The booking moves to another tab: follow it there and confirm what happened.
    const tab = { accept: "upcoming", reject: "requests", start: "upcoming", complete: "past" }[decision];
    target = `/artist-portal/orders?tab=${tab}&done=${decision}`;
  } catch (e) {
    return fail(e);
  }
  redirect(target);
}

// ------------------------------------------------------------------ bank & payouts
export async function saveBankAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction();
    const b = z
      .object({
        holder_name: z.string().min(3, "Enter the account holder’s name exactly as at the bank").max(80),
        account: z.string().regex(/^\d{9,18}$/, "Account number should be 9–18 digits"),
        account_confirm: z.string(),
        ifsc: z.string().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC code, e.g. HDFC0001234"),
        bank_name: z.string().max(80),
        upi_id: z.string().max(80).refine((v) => !v || /^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(v), "Enter a valid UPI ID, e.g. name@okhdfc"),
      })
      .refine((v) => v.account === v.account_confirm, { message: "Account numbers do not match", path: ["account_confirm"] })
      .parse({
        holder_name: s(form.get("holder_name")),
        account: s(form.get("account")).replace(/\s/g, ""),
        account_confirm: s(form.get("account_confirm")).replace(/\s/g, ""),
        ifsc: s(form.get("ifsc")),
        bank_name: s(form.get("bank_name")),
        upi_id: s(form.get("upi_id")),
      });
    const db = await getDb();
    const had = (await db.query(`SELECT 1 FROM artist_bank_accounts WHERE artist_id = $1`, [a.id])).length > 0;
    await db.query(
      `INSERT INTO artist_bank_accounts(artist_id, holder_name, account_enc, account_last4, ifsc, bank_name, upi_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (artist_id) DO UPDATE SET holder_name=EXCLUDED.holder_name, account_enc=EXCLUDED.account_enc, account_last4=EXCLUDED.account_last4,
         ifsc=EXCLUDED.ifsc, bank_name=EXCLUDED.bank_name, upi_id=EXCLUDED.upi_id, updated_at=now(), verified_at=NULL, verified_by=NULL`,
      [a.id, b.holder_name, encryptField(b.account), b.account.slice(-4), b.ifsc, b.bank_name, b.upi_id || null],
    );
    await audit(a.user_id, had ? "artist_bank_changed" : "artist_bank_added", "artist", a.id, { last4: b.account.slice(-4), ifsc: b.ifsc });
    if (a.email)
      queueEmail({
        to: a.email,
        template: had ? "artist_bank_changed" : "artist_bank_added",
        artistId: a.id,
        subject: had ? "Your payout bank account was changed" : "Your payout bank account was added",
        heading: had ? "Bank account changed" : "Bank account added",
        paragraphs: [
          `Payouts will now go to the account ending ${b.account.slice(-4)} (${b.ifsc}).`,
          "If you did not make this change, raise a support ticket immediately or call our support team.",
        ],
        cta: { label: "View payouts", path: "/artist-portal/payouts" },
      });
    revalidatePath("/artist-portal", "layout");
    return { ok: "Bank account saved securely." };
  } catch (e) {
    return fail(e);
  }
}

export async function requestPayoutAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction({ active: true });
    const amount = rupees(form.get("amount"));
    const db = await getDb();
    const id = await db.tx((q) => requestPayout(q, a.id, amount));
    await audit(a.user_id, "payout_requested", "payout", id, { amount });
    notifyTeam({
      template: "payout_request",
      artistId: a.id,
      subject: `Payout request: ₹${(amount / 100).toLocaleString("en-IN")} from ${a.name}`,
      heading: "New payout request",
      paragraphs: [`${a.name} requested a payout of ₹${(amount / 100).toLocaleString("en-IN")}.`],
      path: "/admin/payouts",
    });
    revalidatePath("/artist-portal", "layout");
    revalidatePath("/admin/payouts");
    return { ok: "Payout requested. You will get an email once it is sent to your bank." };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------ support
export async function createTicketAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  try {
    const a = await artistForAction();
    const t = z
      .object({
        subject: z.string().min(5, "Add a short subject").max(120),
        category: z.enum(TICKET_CATEGORIES),
        priority: z.enum(TICKET_PRIORITIES),
        booking_code: z.string().max(20),
        body: z.string().min(10, "Describe the problem in a little more detail").max(3000),
      })
      .parse(Object.fromEntries(["subject", "category", "priority", "booking_code", "body"].map((k) => [k, s(form.get(k))])));
    const db = await getDb();
    const r = await db.tx((q) =>
      createTicket(q, { artistId: a.id, requesterName: a.name, requesterContact: a.email ?? a.phone, subject: t.subject, category: t.category, priority: t.priority, bookingCode: t.booking_code.toUpperCase(), body: t.body, authorId: a.user_id }),
    );
    id = r.id;
    await audit(a.user_id, "ticket_create", "support_ticket", r.id, { code: r.code });
    notifyTeam({
      template: "ticket_new",
      artistId: a.id,
      subject: `[${r.code}] ${t.priority === "urgent" || t.priority === "high" ? `${t.priority.toUpperCase()} — ` : ""}${t.subject}`,
      heading: "New support ticket from an artist",
      paragraphs: [`From ${a.name}${t.booking_code ? ` about booking ${t.booking_code.toUpperCase()}` : ""}:`, t.body.slice(0, 1200)],
      path: `/admin/support/${r.id}`,
    });
    revalidatePath("/admin/support");
  } catch (e) {
    return fail(e);
  }
  redirect(`/artist-portal/support/${id}?created=1`);
}

export async function replyTicketAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const a = await artistForAction();
    const id = z.string().uuid().parse(s(form.get("ticketId")));
    const close = s(form.get("close")) === "1";
    const body = close ? s(form.get("body")) || "Closed by artist — issue solved." : z.string().min(2, "Write a message").max(3000).parse(s(form.get("body")));
    const db = await getDb();
    const own = await db.query(`SELECT 1 FROM support_tickets WHERE id = $1 AND artist_id = $2`, [id, a.id]);
    if (!own.length) return { error: "Ticket not found." };
    await db.tx((q) => replyToTicket(q, id, { authorType: "artist", authorId: a.user_id, authorName: a.name, body, status: close ? "closed" : undefined }));
    if (!close)
      notifyTeam({ template: "ticket_reply", artistId: a.id, subject: `Artist replied on a ticket`, heading: `${a.name} replied`, paragraphs: [body.slice(0, 1200)], path: `/admin/support/${id}` });
    revalidatePath(`/artist-portal/support/${id}`);
    revalidatePath("/admin/support");
    return { ok: close ? "Ticket closed." : "Reply sent." };
  } catch (e) {
    return fail(e);
  }
}
