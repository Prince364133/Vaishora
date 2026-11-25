import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireArtist } from "@/server/artist-auth";
import { getDb } from "@/server/db";
import { getArtistProfile } from "@/server/artist-portal";
import { cachedCategories, cachedLocalities, cachedSettings } from "@/server/cached";
import { ActionForm } from "@/components/admin/ActionForm";
import { PhotoInput } from "@/components/artist/PhotoInput";
import { AreaSearch } from "@/components/artist/AreaSearch";
import { Badge, PageHeader } from "@/components/artist/ui";
import { initials } from "@/components/artists/ArtistCard";
import { addPortfolioAction, artistSignOutAction, removePortfolioAction, saveAreasAction, saveProfileAction } from "../../actions";
import { formatPhone } from "@/lib/format";
import { AdaptiveSkeleton } from "@/components/artist/AdaptiveSkeleton";

export const metadata: Metadata = { title: "Profile" };

const STATUS = { pending: ["Pending verification", "warning"], active: ["Verified artist", "success"], suspended: ["Paused", "danger"], rejected: ["Not approved", "danger"] } as const;

async function Profile() {
  await connection();
  const a = await requireArtist();
  const db = await getDb();
  const [p, categories, localities, settings, tickets] = await Promise.all([
    getArtistProfile(db, a.id),
    cachedCategories(),
    cachedLocalities(),
    cachedSettings(),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM support_tickets WHERE artist_id = $1 AND status = 'awaiting_reply'`, [a.id]),
  ]);
  if (!p) return null;
  const zones = [...new Set(localities.map((l) => l.zone))];
  const [statusLabel, statusTone] = STATUS[p.status];
  const phone = settings.support.phone;
  return (
    <>
      <PageHeader title="Profile" subtitle="This is what customers see on your VAISHORA profile." />

      <div className="card flex items-center gap-4 p-4">
        {p.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.photo_url} alt="" className="h-16 w-16 flex-none rounded-full object-cover" />
        ) : (
          <span className="grid h-16 w-16 flex-none place-items-center rounded-full bg-plum font-display text-2xl text-ivory" aria-hidden>
            {initials(p.name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-2xl text-plum">{p.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone={statusTone}>{statusLabel}</Badge>
            {p.status === "active" && (
              <Link href={`/artists/${p.slug}`} target="_blank" className="link text-sm">
                View public profile
              </Link>
            )}
          </div>
        </div>
      </div>

      <nav className="mt-4 grid grid-cols-3 gap-2" aria-label="More">
        {[
          ["/artist-portal/schedule", "Working hours"],
          ["/artist-portal/payouts", "Payouts & bank"],
          ["/artist-portal/support", tickets[0].n ? `Support (${tickets[0].n})` : "Support"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="card flex min-h-14 items-center justify-center px-2 text-center text-sm font-semibold text-plum hover:bg-blush/50">
            {label}
          </Link>
        ))}
      </nav>

      <section id="about" className="mt-6 scroll-mt-20">
        <h2 className="text-2xl">About you</h2>
        <ActionForm action={saveProfileAction} submitLabel="Save profile" encType="multipart/form-data" className="card mt-3 space-y-4 p-4 sm:p-5">
          <PhotoInput name="photo" label={p.photo_url ? "Change profile photo" : "Profile photo"} hint="A clear, friendly photo of your face builds trust with customers." />
          <div className="field">
            <label htmlFor="name">Name shown to customers</label>
            <input id="name" name="name" className="input" required minLength={2} maxLength={80} defaultValue={p.name} autoComplete="name" autoCapitalize="words" />
          </div>
          <div className="field">
            <label htmlFor="bio">About you</label>
            <textarea id="bio" name="bio" className="input min-h-32" maxLength={1200} defaultValue={p.bio} placeholder="Your story, styles you love, bridal experience, the henna you use…" />
            <p className="field-hint">At least 40 characters. Shown at the top of your profile.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="experience_years">Years of experience</label>
              <input id="experience_years" name="experience_years" type="number" inputMode="numeric" min={0} max={60} className="input" defaultValue={p.experience_years ?? ""} />
              <p className="field-hint">{p.experience_verified ? "Verified by VAISHORA ✓" : "Shown on your profile once our team verifies it."}</p>
            </div>
            <div className="field">
              <label htmlFor="languages">Languages you speak</label>
              <input id="languages" name="languages" className="input" maxLength={120} defaultValue={p.languages} placeholder="Telugu, Hindi, English" />
            </div>
            <div className="field">
              <label htmlFor="phone">Mobile number</label>
              <input id="phone" name="phone" type="tel" inputMode="tel" className="input" required defaultValue={p.phone} autoComplete="tel" />
              <p className="field-hint">Shared with customers only for confirmed bookings.</p>
            </div>
            <div className="field">
              <label htmlFor="instagram">Instagram</label>
              <input id="instagram" name="instagram" className="input" maxLength={200} defaultValue={p.instagram ?? ""} placeholder="@yourhandle" autoCapitalize="none" spellCheck={false} />
            </div>
          </div>
        </ActionForm>
      </section>

      <section id="areas" className="mt-8 scroll-mt-20">
        <h2 className="text-2xl">Service areas and specialties</h2>
        <p className="mt-1 text-sm text-muted">Customers in these areas see your free slots. Choose only places you can reach on time.</p>
        <ActionForm action={saveAreasAction} submitLabel="Save areas and specialties" resetOnSuccess={false} className="card mt-3 space-y-5 p-4 sm:p-5">
          <fieldset>
            <legend className="text-sm font-semibold text-plum-ink">Specialties</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {categories.map((c) => (
                <label key={c.slug} className="chip cursor-pointer has-[:checked]:border-plum has-[:checked]:bg-plum has-[:checked]:text-ivory">
                  <input type="checkbox" name="services" value={c.slug} defaultChecked={p.services.includes(c.slug)} className="sr-only" />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
          {zones.map((z) => (
            <fieldset key={z}>
              <legend className="text-sm font-semibold text-plum-ink">{z}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {localities
                  .filter((l) => l.zone === z)
                  .map((l) => (
                    <label key={l.id} className="chip cursor-pointer has-[:checked]:border-plum has-[:checked]:bg-plum has-[:checked]:text-ivory">
                      <input type="checkbox" name="localities" value={l.id} defaultChecked={p.localities.includes(l.id)} className="sr-only" />
                      {l.name}
                    </label>
                  ))}
              </div>
            </fieldset>
          ))}
          <div className="field max-w-xs">
            <label htmlFor="max_bookings_per_day">
              Most bookings per day <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="max_bookings_per_day" name="max_bookings_per_day" type="number" inputMode="numeric" min={1} max={20} className="input" defaultValue={p.max_bookings_per_day ?? ""} placeholder="No limit" />
          </div>
        </ActionForm>
        <div className="mt-3">
          <AreaSearch />
        </div>
      </section>

      <section id="portfolio" className="mt-8 scroll-mt-20">
        <h2 className="text-2xl">Portfolio</h2>
        <p className="mt-1 text-sm text-muted">Photos of your past work, shown on your profile ({p.portfolio.length}/24).</p>
        {p.portfolio.length > 0 && (
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {p.portfolio.map((ph) => (
              <li key={ph.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ph.image_url} alt={ph.caption || "Portfolio photo"} loading="lazy" decoding="async" className="aspect-square w-full rounded-[var(--radius-sm)] object-cover" />
                <ActionForm action={removePortfolioAction} submitLabel="Remove" pendingLabel="…" danger className="absolute inset-x-1 bottom-1 [&>div]:mt-0 [&_p]:hidden [&_button]:w-full [&_button]:min-h-9">
                  <input type="hidden" name="id" value={ph.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addPortfolioAction} submitLabel="Add to portfolio" pendingLabel="Uploading…" encType="multipart/form-data" className="card mt-3 space-y-4 p-4 sm:p-5">
          <PhotoInput name="images" label="Add photos" multiple max={8} required />
          <div className="field">
            <label htmlFor="caption">
              Caption <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="caption" name="caption" className="input" maxLength={120} placeholder="e.g. Bridal mehndi, Kondapur, 2026" />
          </div>
        </ActionForm>
      </section>

      <section className="mt-8 card p-4 sm:p-5">
        <h2 className="text-xl">Account</h2>
        <dl className="mt-2 grid gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-28 text-muted">Sign-in email</dt>
            <dd className="[overflow-wrap:anywhere]">{p.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 text-muted">City</dt>
            <dd>{p.city}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted">To change your sign-in email, raise a support ticket{phone ? ` or call ${formatPhone(phone)}` : ""}.</p>
        <form action={artistSignOutAction} className="mt-4">
          <button className="btn btn-secondary btn-sm">Sign out</button>
        </form>
      </section>
    </>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <Profile />
    </Suspense>
  );
}
