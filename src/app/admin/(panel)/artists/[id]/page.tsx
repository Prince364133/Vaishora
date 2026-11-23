import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { requireRole } from "@/server/auth";
import { listCategories, listLocalities } from "@/server/catalog";
import { ActionForm } from "@/components/admin/ActionForm";
import { addTimeOffAction, createArtistLoginAction, saveArtistAction } from "../../../actions";
import { formatIstDate } from "@/lib/time";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

interface ArtistRow {
  id: string; slug: string; name: string; phone: string; bio: string; instagram: string | null; experience_years: number | null; experience_verified: boolean;
  skill_level: string; status: string; verified_at: string | null; verification_notes: string | null; is_demo: boolean; user_id: string | null; photo_url: string | null;
}

async function Editor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  await connection();
  await requireRole(["admin"]);
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const isNew = id === "new";
  if (!isNew && !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await getDb();
  const [rows, localities, categories] = await Promise.all([
    isNew ? Promise.resolve([] as ArtistRow[]) : db.query<ArtistRow>(`SELECT * FROM artists WHERE id = $1`, [id]),
    listLocalities({ includeInactive: true }),
    listCategories({ includeInactive: true }),
  ]);
  const a = rows[0];
  if (!isNew && !a) notFound();
  const [areas, services, avail, timeOff, portfolio] = isNew
    ? [[], [], [], [], []]
    : await Promise.all([
        db.query<{ locality_id: number }>(`SELECT locality_id FROM artist_service_areas WHERE artist_id = $1`, [id]),
        db.query<{ category_slug: string }>(`SELECT category_slug FROM artist_services WHERE artist_id = $1`, [id]),
        db.query<{ weekday: number; start_minute: number; end_minute: number }>(`SELECT weekday, start_minute, end_minute FROM artist_availability WHERE artist_id = $1`, [id]),
        db.query<{ lo: string; hi: string; reason: string }>(`SELECT lower(period) AS lo, upper(period) AS hi, reason FROM artist_time_off WHERE artist_id = $1 AND upper(period) > now() ORDER BY lower(period)`, [id]),
        db.query<{ image_url: string }>(`SELECT image_url FROM artist_portfolios WHERE artist_id = $1 ORDER BY sort`, [id]),
      ]);
  const areaSet = new Set(areas.map((r) => r.locality_id));
  const svcSet = new Set(services.map((r) => r.category_slug));

  return (
    <>
      <Link href="/admin/artists" className="link tap-link text-sm">All artists</Link>
      <h1 className="mt-1 text-[2.25rem] sm:text-4xl">{isNew ? "Add artist" : a!.name}</h1>
      {a?.is_demo && <p className="mt-2 sample-badge">Demo profile — hidden from customers in production unless demo artists are enabled</p>}
      {sp.saved && <p className="mt-3 rounded-[var(--radius-sm)] bg-success/10 px-4 py-2 text-sm text-success">Saved.</p>}

      <ActionForm action={saveArtistAction} submitLabel={isNew ? "Create artist" : "Save artist"} encType="multipart/form-data" className="mt-5 card p-4 sm:p-5">
        <input type="hidden" name="id" value={a?.id ?? ""} />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="field"><span className="label">Name</span><input name="name" required defaultValue={a?.name} className="input" /></label>
          <label className="field"><span className="label">Profile URL slug</span><input name="slug" required autoCapitalize="none" spellCheck={false} defaultValue={a?.slug} className="input" /></label>
          <label className="field"><span className="label">Phone (+91…)</span><input name="phone" type="tel" inputMode="tel" autoComplete="off" required defaultValue={a?.phone ?? "+91"} className="input" /></label>
          <label className="field"><span className="label">Instagram</span><input name="instagram" inputMode="url" autoCapitalize="none" spellCheck={false} defaultValue={a?.instagram ?? ""} className="input" /></label>
          <label className="field md:col-span-2"><span className="label">Bio</span><textarea name="bio" maxLength={800} defaultValue={a?.bio} className="input min-h-24" /></label>
          <label className="field"><span className="label">Years of experience</span><input name="experience_years" type="number" inputMode="numeric" min={0} max={60} defaultValue={a?.experience_years ?? ""} className="input" /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm md:self-end md:pb-1"><input type="checkbox" name="experience_verified" defaultChecked={a?.experience_verified} /> Experience verified (shown publicly only when checked)</label>
          <label className="field"><span className="label">Skill level</span>
            <select name="skill_level" defaultValue={a?.skill_level ?? "standard"} className="input"><option value="standard">Standard</option><option value="senior">Senior</option><option value="bridal_specialist">Bridal specialist</option></select>
          </label>
          <label className="field"><span className="label">Status</span>
            <select name="status" defaultValue={a?.status ?? "pending"} className="input"><option value="pending">Pending review</option><option value="active">Active (can take bookings)</option><option value="suspended">Suspended</option></select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="verified" defaultChecked={!!a?.verified_at} /> Identity and work verified (shows a Verified badge){a?.verified_at && ` — since ${formatIstDate(a.verified_at)}`}</label>
          <label className="field md:col-span-2"><span className="label">Verification notes (internal)</span><textarea name="verification_notes" defaultValue={a?.verification_notes ?? ""} className="input" placeholder="Documents checked, trial session, references" /></label>
        </div>

        <fieldset className="min-w-0 mt-6">
          <legend className="font-semibold">Specialties</legend>
          <div className="mt-1 flex flex-wrap gap-x-5">
            {categories.map((c) => <label key={c.slug} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="services" value={c.slug} defaultChecked={svcSet.has(c.slug)} /> {c.name}</label>)}
          </div>
        </fieldset>
        <fieldset className="min-w-0 mt-6">
          <legend className="font-semibold">Service areas</legend>
          <div className="mt-1 grid grid-cols-2 gap-x-3 sm:grid-cols-4">
            {localities.map((l) => <label key={l.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="localities" value={l.id} defaultChecked={areaSet.has(l.id)} /> {l.name}</label>)}
          </div>
        </fieldset>
        <fieldset className="min-w-0 mt-6">
          <legend className="font-semibold">Weekly working hours (IST)</legend>
          <div className="mt-2 space-y-3 sm:space-y-2">
            {DAYS.map((d, i) => {
              const w = avail.find((x) => x.weekday === i);
              return (
                <div key={d} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 text-sm sm:flex sm:gap-3">
                  <label className="col-span-3 flex min-h-11 items-center gap-2 sm:w-32"><input type="checkbox" name={`day_${i}_on`} defaultChecked={!!w} /> {d}</label>
                  <input type="time" name={`day_${i}_start`} defaultValue={w ? hhmm(w.start_minute) : "09:00"} className="input min-h-11 py-1 sm:w-36" aria-label={`${d} start`} />
                  <span>to</span>
                  <input type="time" name={`day_${i}_end`} defaultValue={w ? hhmm(w.end_minute) : "20:00"} className="input min-h-11 py-1 sm:w-36" aria-label={`${d} end`} />
                </div>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="min-w-0 mt-6 grid gap-4 sm:grid-cols-2">
          <label className="field"><span className="label">Profile photo</span><input type="file" name="photo" accept="image/png,image/webp,image/jpeg" className="w-full text-sm" /></label>
          <label className="field"><span className="label">Add portfolio images</span><input type="file" name="portfolio" accept="image/png,image/webp,image/jpeg" multiple className="w-full text-sm" /></label>
        </fieldset>
        {portfolio.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {portfolio.map((p, i) => <img key={i} src={p.image_url} alt="" className="h-20 w-20 rounded bg-blush object-cover" />)}
          </div>
        )}
      </ActionForm>

      {!isNew && (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section className="card p-4 sm:p-5">
            <h2 className="font-sans text-base font-semibold">Time off</h2>
            <ul className="mt-2 text-sm text-muted">
              {timeOff.map((t, i) => <li key={i}>{formatIstDate(t.lo)} – {formatIstDate(new Date(new Date(t.hi).getTime() - 1))}{t.reason && ` — ${t.reason}`}</li>)}
              {!timeOff.length && <li>None scheduled.</li>}
            </ul>
            <ActionForm action={addTimeOffAction} submitLabel="Add time off" className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="artistId" value={a!.id} />
              <label className="field"><span className="label">From</span><input type="date" name="from" required className="input" /></label>
              <label className="field"><span className="label">To</span><input type="date" name="to" required className="input" /></label>
              <input name="reason" placeholder="Reason (optional)" className="input sm:col-span-2" />
            </ActionForm>
          </section>
          <section className="card p-4 sm:p-5">
            <h2 className="font-sans text-base font-semibold">Artist portal login</h2>
            {a!.user_id ? (
              <p className="mt-2 text-sm text-muted">This artist has a login and can accept, decline and complete their bookings at /artist-portal.</p>
            ) : (
              <ActionForm action={createArtistLoginAction} submitLabel="Create login" className="mt-3 space-y-2">
                <input type="hidden" name="artistId" value={a!.id} />
                <input type="email" name="email" placeholder="Artist email" aria-label="Artist email" autoCapitalize="none" spellCheck={false} autoComplete="off" required className="input" />
                <input type="text" name="password" placeholder="Temporary password (10+ chars)" aria-label="Temporary password" autoCapitalize="none" autoComplete="off" spellCheck={false} required minLength={10} className="input" />
              </ActionForm>
            )}
          </section>
        </div>
      )}
    </>
  );
}

export default function ArtistEditor(props: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Editor {...props} />
    </Suspense>
  );
}
