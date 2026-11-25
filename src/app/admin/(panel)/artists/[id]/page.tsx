import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { requireRole } from "@/server/auth";
import { listCategories, listLocalities } from "@/server/catalog";
import { ActionForm } from "@/components/admin/ActionForm";
import { addTimeOffAction, ledgerAdjustmentAction, reviewArtistAction, saveArtistAction, setArtistMarginAction, verifyBankAction } from "../../../actions";
import { artistBalance } from "@/server/ledger";
import { getSettings } from "@/server/settings";
import { formatPaise } from "@/lib/money";
import { percentFromBp } from "@/lib/format";
import { formatIstDate } from "@/lib/time";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

interface ArtistRow {
  id: string; slug: string; name: string; phone: string; bio: string; instagram: string | null; experience_years: number | null; experience_verified: boolean;
  skill_level: string; status: string; verified_at: string | null; verification_notes: string | null; is_demo: boolean; user_id: string | null; photo_url: string | null;
  email: string | null; areas_text: string; experience_text: string; portfolio_url: string | null; application_note: string; applied_at: string | null; languages: string;
  rejection_reason: string | null; margin_bp: number | null; identity_sub: string | null;
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
  const [bal, bankRows, settings] = isNew
    ? [null, [], await getSettings(db)]
    : await Promise.all([
        artistBalance(db, id),
        db.query<{ holder_name: string; account_last4: string; ifsc: string; bank_name: string; upi_id: string | null; updated_at: string; verified_at: string | null }>(
          `SELECT holder_name, account_last4, ifsc, bank_name, upi_id, updated_at, verified_at FROM artist_bank_accounts WHERE artist_id = $1`,
          [id],
        ),
        getSettings(db),
      ]);
  const bank = bankRows[0];
  const centralBp = settings.platform_margin_bp;
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
          <label className="field"><span className="label">Sign-in email (180 Identity)</span><input name="email" type="email" autoCapitalize="none" spellCheck={false} autoComplete="off" defaultValue={a?.email ?? ""} className="input" placeholder="artist@example.com" /></label>
          <label className="field"><span className="label">Instagram</span><input name="instagram" inputMode="url" autoCapitalize="none" spellCheck={false} defaultValue={a?.instagram ?? ""} className="input" /></label>
          <label className="field md:col-span-2"><span className="label">Bio</span><textarea name="bio" maxLength={800} defaultValue={a?.bio} className="input min-h-24" /></label>
          <label className="field"><span className="label">Years of experience</span><input name="experience_years" type="number" inputMode="numeric" min={0} max={60} defaultValue={a?.experience_years ?? ""} className="input" /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm md:self-end md:pb-1"><input type="checkbox" name="experience_verified" defaultChecked={a?.experience_verified} /> Experience verified (shown publicly only when checked)</label>
          <label className="field"><span className="label">Skill level</span>
            <select name="skill_level" defaultValue={a?.skill_level ?? "standard"} className="input"><option value="standard">Standard</option><option value="senior">Senior</option><option value="bridal_specialist">Bridal specialist</option></select>
          </label>
          <label className="field"><span className="label">Status</span>
            <select name="status" defaultValue={a?.status ?? "pending"} className="input"><option value="pending">Pending review</option><option value="active">Active (can take bookings)</option><option value="suspended">Suspended</option><option value="rejected">Rejected</option></select>
            <span className="field-hint">To notify the artist by email, use the approve / reject / suspend buttons below instead.</span>
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
        {a?.user_id ? (
          <div className="mt-6">
            <p className="font-semibold">Weekly working hours (IST)</p>
            <p className="text-sm text-muted">Managed by the artist in their portal.</p>
            <ul className="mt-1 text-sm">
              {DAYS.map((d, i) => {
                const ws = avail.filter((x) => x.weekday === i);
                return <li key={d}>{d}: {ws.length ? ws.map((w) => `${hhmm(w.start_minute)}–${hhmm(w.end_minute)}`).join(", ") : <span className="text-muted">off</span>}</li>;
              })}
            </ul>
          </div>
        ) : (
        <fieldset className="min-w-0 mt-6">
          <input type="hidden" name="manage_hours" value="1" />
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
        )}
        <fieldset className="min-w-0 mt-6 grid gap-4 sm:grid-cols-2">
          <label className="field"><span className="label">Profile photo</span><input type="file" name="photo" accept="image/png,image/webp,image/jpeg" className="w-full text-sm" /></label>
          <label className="field"><span className="label">Add portfolio images</span><input type="file" name="portfolio" accept="image/png,image/webp,image/jpeg" multiple className="w-full text-sm" /></label>
        </fieldset>
        {portfolio.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {portfolio.map((p, i) => <img key={i} src={p.image_url} alt="" loading="lazy" decoding="async" className="h-20 w-20 rounded bg-blush object-cover" />)}
          </div>
        )}
      </ActionForm>

      {!isNew && (
        <div className="mt-6 grid gap-6 md:grid-cols-2 [&>section]:min-w-0">
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
            <h2 className="font-sans text-base font-semibold">Account & verification</h2>
            <p className="mt-2 text-sm">
              Status: <strong className="capitalize">{a!.status}</strong>
              {a!.email ? (
                <>
                  {" "}
                  · signs in with <span className="[overflow-wrap:anywhere]">{a!.email}</span>
                </>
              ) : (
                <span className="text-danger"> · no sign-in email set</span>
              )}
              {a!.identity_sub ? " · 180 account linked" : ""}
            </p>
            {a!.rejection_reason && <p className="mt-1 text-sm text-muted">Reason given: {a!.rejection_reason}</p>}
            <div className="mt-3 flex flex-wrap gap-x-3">
              {(a!.status === "pending" || a!.status === "rejected") && (
                <ActionForm action={reviewArtistAction} submitLabel="Approve & email artist">
                  <input type="hidden" name="artistId" value={a!.id} />
                  <input type="hidden" name="decision" value="approve" />
                </ActionForm>
              )}
              {a!.status === "suspended" && (
                <ActionForm action={reviewArtistAction} submitLabel="Reactivate">
                  <input type="hidden" name="artistId" value={a!.id} />
                  <input type="hidden" name="decision" value="reactivate" />
                </ActionForm>
              )}
            </div>
            {(a!.status === "pending" || a!.status === "active") && (
              <ActionForm action={reviewArtistAction} submitLabel={a!.status === "pending" ? "Reject application" : "Suspend artist"} danger confirm="Tap again to confirm" className="mt-2">
                <input type="hidden" name="artistId" value={a!.id} />
                <input type="hidden" name="decision" value={a!.status === "pending" ? "reject" : "suspend"} />
                <input name="reason" required minLength={5} maxLength={500} placeholder="Reason (the artist sees this)" aria-label="Reason" className="input mt-2" />
              </ActionForm>
            )}
            {a!.applied_at && (
              <dl className="mt-4 grid gap-1 border-t hairline pt-3 text-sm">
                <div>
                  <dt className="inline text-muted">Applied: </dt>
                  <dd className="inline">{formatIstDate(a!.applied_at)}</dd>
                </div>
                {a!.areas_text && (
                  <div>
                    <dt className="inline text-muted">Areas: </dt>
                    <dd className="inline">{a!.areas_text}</dd>
                  </div>
                )}
                {a!.experience_text && (
                  <div>
                    <dt className="inline text-muted">Experience: </dt>
                    <dd className="inline">{a!.experience_text}</dd>
                  </div>
                )}
                {a!.languages && (
                  <div>
                    <dt className="inline text-muted">Languages: </dt>
                    <dd className="inline">{a!.languages}</dd>
                  </div>
                )}
                {a!.portfolio_url && (
                  <div>
                    <dt className="inline text-muted">Portfolio: </dt>
                    <dd className="inline [overflow-wrap:anywhere]">
                      <a className="link" href={a!.portfolio_url} target="_blank" rel="noreferrer">
                        {a!.portfolio_url}
                      </a>
                    </dd>
                  </div>
                )}
                {a!.application_note && (
                  <div>
                    <dt className="inline text-muted">Note: </dt>
                    <dd className="inline">{a!.application_note}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>
          <section className="card p-4 sm:p-5">
            <h2 className="font-sans text-base font-semibold">Earnings & margin</h2>
            <p className="mt-2 text-sm">
              Balance <strong className={bal!.available_paise < 0 ? "text-danger" : ""}>{formatPaise(bal!.available_paise)}</strong> · in progress {formatPaise(bal!.pending_payout_paise)} · paid out{" "}
              {formatPaise(bal!.paid_out_paise)}
            </p>
            <p className="text-sm text-muted">
              Lifetime bookings {formatPaise(bal!.lifetime_gross_paise)} · platform margin {formatPaise(bal!.lifetime_margin_paise)}
            </p>
            <ActionForm action={setArtistMarginAction} submitLabel="Save margin" resetOnSuccess={false} className="mt-3">
              <input type="hidden" name="artistId" value={a!.id} />
              <label className="field">
                <span className="label">Margin override (%)</span>
                <input name="margin_percent" type="number" step="0.01" min={0} max={60} defaultValue={a!.margin_bp != null ? a!.margin_bp / 100 : ""} placeholder={`Central: ${percentFromBp(centralBp)}`} className="input max-w-40" />
                <span className="field-hint">Leave empty to use the central margin ({percentFromBp(centralBp)}).</span>
              </label>
            </ActionForm>
            <ActionForm action={ledgerAdjustmentAction} submitLabel="Record adjustment" className="mt-4 border-t hairline pt-3">
              <input type="hidden" name="artistId" value={a!.id} />
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                <input name="amount" type="number" step="0.01" required placeholder="± ₹" aria-label="Adjustment amount in rupees (negative to deduct)" className="input" />
                <input name="note" required minLength={5} maxLength={200} placeholder="Reason (visible to the artist)" aria-label="Adjustment reason" className="input" />
              </div>
            </ActionForm>
          </section>
          <section className="card p-4 sm:p-5">
            <h2 className="font-sans text-base font-semibold">Bank account</h2>
            {bank ? (
              <>
                <p className="mt-2 text-sm">
                  {bank.holder_name} · •••• {bank.account_last4} · {bank.ifsc}
                  {bank.bank_name ? ` · ${bank.bank_name}` : ""}
                  {bank.upi_id ? ` · UPI ${bank.upi_id}` : ""}
                </p>
                <p className="text-sm text-muted">
                  Updated {formatIstDate(bank.updated_at)} · {bank.verified_at ? `verified ${formatIstDate(bank.verified_at)}` : "not verified"}
                </p>
                {!bank.verified_at && (
                  <ActionForm action={verifyBankAction} submitLabel="Mark bank verified">
                    <input type="hidden" name="artistId" value={a!.id} />
                  </ActionForm>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">The artist has not added a bank account.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}

export default function ArtistEditor(props: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <Editor {...props} />
    </Suspense>
  );
}
