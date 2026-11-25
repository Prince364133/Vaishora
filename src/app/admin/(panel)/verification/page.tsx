import Link from "next/link";
import { connection } from "next/server";
import { requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { ActionForm } from "@/components/admin/ActionForm";
import { reviewArtistAction, reviewDesignAction } from "../../actions";
import { formatPaise } from "@/lib/money";
import { formatDuration, formatIstDate } from "@/lib/time";
import { formatPhone, timeAgo } from "@/lib/format";
import { describeChanges, DesignSnapshot } from "@/server/design-revisions";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";
import { KeyedSuspense } from "@/components/skeleton/KeyedSuspense";

export const metadata = { title: "Verification" };

async function Queue({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await connection();
  const user = await requireRole(["admin", "staff"]);
  const { tab: raw } = await searchParams;
  const db = await getDb();
  const [artists, designs, counts] = await Promise.all([
    db.query<{
      id: string; name: string; email: string | null; phone: string; areas_text: string; experience_years: number | null; experience_text: string;
      instagram: string | null; portfolio_url: string | null; languages: string; application_note: string; applied_at: string | null; created_at: string;
    }>(
      `SELECT id, name, email, phone, areas_text, experience_years, experience_text, instagram, portfolio_url, languages, application_note, applied_at, created_at
       FROM artists WHERE status = 'pending' ORDER BY COALESCE(applied_at, created_at)`,
    ),
    db.query<{
      id: string; slug: string; name: string; description: string; includes: string; category_slug: string; category: string; region: DesignSnapshot["region"];
      complexity: DesignSnapshot["complexity"]; duration_minutes: number; base_price_paise: number; video_url: string | null; submitted_at: string | null;
      artist_id: string; artist_name: string; artist_status: string; photos: string[]; assets: DesignSnapshot["assets"]; pending_changes: DesignSnapshot | null;
    }>(
      `SELECT d.id, d.slug, d.name, d.description, d.includes, d.category_slug, c.name AS category, d.region, d.complexity, d.duration_minutes, d.base_price_paise,
              d.video_url, COALESCE(d.pending_submitted_at, d.submitted_at) AS submitted_at, d.pending_changes,
              a.id AS artist_id, a.name AS artist_name, a.status AS artist_status,
              COALESCE((SELECT array_agg(p.url ORDER BY p.sort, p.created_at) FROM design_photos p WHERE p.design_id = d.id), '{}') AS photos,
              COALESCE((SELECT jsonb_object_agg(x.kind, x.url) FROM design_assets x WHERE x.design_id = d.id), '{}'::jsonb) AS assets
       FROM designs d JOIN artists a ON a.id = d.artist_id JOIN design_categories c ON c.slug = d.category_slug
       WHERE d.review_status = 'pending' OR d.pending_changes IS NOT NULL ORDER BY COALESCE(d.pending_submitted_at, d.submitted_at) NULLS FIRST`,
    ),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM artists WHERE status = 'rejected'`),
  ]);
  const tab = raw === "designs" || (!raw && !artists.length && designs.length) ? "designs" : "artists";
  const admin = user.role === "admin";
  return (
    <>
      <nav className="mt-4 inline-grid grid-cols-2 rounded-[var(--radius-md)] bg-blush p-1" aria-label="Queue">
        {(
          [
            ["artists", `Artist applications (${artists.length})`],
            ["designs", `Designs (${designs.length})`],
          ] as const
        ).map(([k, l]) => (
          <Link key={k} href={`/admin/verification?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-[var(--radius-sm)] px-4 text-sm font-semibold ${tab === k ? "bg-white text-plum shadow-sm" : "text-muted"}`}>
            {l}
          </Link>
        ))}
      </nav>

      {tab === "artists" ? (
        <section className="mt-5 space-y-4">
          {!admin && <p className="text-sm text-muted">Only admins can approve or reject artists.</p>}
          {artists.map((a) => (
            <article key={a.id} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-2xl text-plum">{a.name}</h2>
                  <p className="text-sm text-muted [overflow-wrap:anywhere]">
                    {a.email} · <a className="link" href={`tel:${a.phone}`}>{formatPhone(a.phone)}</a>
                  </p>
                </div>
                <span className="text-xs text-muted">Applied {timeAgo(a.applied_at ?? a.created_at)}</span>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-muted">Experience</dt><dd>{a.experience_years != null ? `${a.experience_years} years` : "—"}{a.experience_text ? ` · ${a.experience_text}` : ""}</dd></div>
                <div><dt className="text-muted">Areas</dt><dd>{a.areas_text || "—"}</dd></div>
                <div><dt className="text-muted">Languages</dt><dd>{a.languages || "—"}</dd></div>
                <div><dt className="text-muted">Portfolio</dt><dd className="[overflow-wrap:anywhere]">{a.portfolio_url ? <a className="link" href={a.portfolio_url} target="_blank" rel="noreferrer">{a.instagram || a.portfolio_url}</a> : "—"}</dd></div>
                {a.application_note && <div className="sm:col-span-2"><dt className="text-muted">Message</dt><dd className="whitespace-pre-wrap">{a.application_note}</dd></div>}
              </dl>
              <div className="mt-3 flex flex-wrap items-start gap-x-4">
                {admin && (
                  <ActionForm action={reviewArtistAction} submitLabel="Approve & email artist" pendingLabel="Approving…">
                    <input type="hidden" name="artistId" value={a.id} />
                    <input type="hidden" name="decision" value="approve" />
                  </ActionForm>
                )}
                <Link href={`/admin/artists/${a.id}`} className="btn btn-ghost btn-sm mt-4">Open full profile</Link>
              </div>
              {admin && (
                <details className="mt-3">
                  <summary className="link tap-link cursor-pointer text-sm">Reject application</summary>
                  <ActionForm action={reviewArtistAction} submitLabel="Reject and email reason" danger className="mt-2">
                    <input type="hidden" name="artistId" value={a.id} />
                    <input type="hidden" name="decision" value="reject" />
                    <textarea name="reason" required minLength={5} maxLength={500} className="input min-h-20" placeholder="Reason shown to the artist (e.g. portfolio link didn’t work, please reapply with photos)" aria-label="Rejection reason" />
                  </ActionForm>
                </details>
              )}
            </article>
          ))}
          {!artists.length && <p className="card p-8 text-center text-muted">No applications waiting. {counts[0].n ? `${counts[0].n} rejected applications are in Artists.` : ""}</p>}
        </section>
      ) : (
        <section className="mt-5 space-y-4">
          {designs.map((row) => {
            const live: DesignSnapshot = { name: row.name, category_slug: row.category_slug, description: row.description, includes: row.includes, region: row.region, complexity: row.complexity, duration_minutes: row.duration_minutes, base_price_paise: row.base_price_paise, video_url: row.video_url, photos: row.photos, assets: row.assets };
            const next = row.pending_changes;
            const d = { ...row, ...(next ?? {}), photos: next?.photos ?? row.photos };
            const changes = next ? describeChanges(live, next) : [];
            return (
            <article key={d.id} className="card p-4 sm:p-5">
              {next && (
                <div className="mb-3 rounded-[var(--radius-sm)] border border-gold bg-gold/10 p-3 text-sm">
                  <p className="font-semibold">Edit of a live design — the current version stays on sale until you approve.</p>
                  <ul className="mt-1 list-disc pl-5">{changes.length ? changes.map((c) => <li key={c}>{c}</li>) : <li>No visible changes</li>}</ul>
                  <Link href={`/designs/${row.slug}`} target="_blank" className="link mt-1 inline-block">View live version</Link>
                </div>
              )}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-2xl text-plum">{d.name}</h2>
                  <p className="text-sm text-muted">
                    by <Link className="link" href={`/admin/artists/${d.artist_id}`}>{d.artist_name}</Link>
                    {d.artist_status !== "active" && <span className="text-danger"> (artist {d.artist_status})</span>} · submitted {d.submitted_at ? formatIstDate(d.submitted_at) : "—"}
                  </p>
                </div>
                <p className="text-right text-sm">
                  <span className="block text-lg font-semibold text-plum">{formatPaise(d.base_price_paise)}</span>
                  <span className="text-muted">{formatDuration(d.duration_minutes)}</span>
                </p>
              </div>
              {d.photos.length > 0 && (
                <ul className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1">
                  {d.photos.map((u) => (
                    <li key={u} className="flex-none snap-start">
                      <a href={u} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt={`Photo of ${d.name}`} loading="lazy" decoding="async" className="h-40 w-40 rounded-[var(--radius-sm)] object-cover" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-sm">{d.category} · {d.region.replace("_", " + ")} · {d.complexity}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{d.description}</p>
              {d.includes && <p className="mt-1 text-sm"><span className="text-muted">Includes:</span> {d.includes}</p>}
              {d.video_url && <p className="mt-1 text-sm"><span className="text-muted">Video:</span> <a className="link" href={d.video_url} target="_blank" rel="noreferrer">{d.video_url}</a></p>}
              {Object.keys(next?.assets ?? row.assets).length > 0 && <p className="mt-1 text-sm text-success">Includes a 3D preview</p>}
              <div className="mt-2 flex flex-wrap items-start gap-x-4">
                <ActionForm action={reviewDesignAction} submitLabel={next ? "Approve changes" : "Approve — make live"} pendingLabel="Approving…">
                  <input type="hidden" name="designId" value={d.id} />
                  <input type="hidden" name="decision" value="approve" />
                </ActionForm>
              </div>
              <details className="mt-3">
                <summary className="link tap-link cursor-pointer text-sm">Ask for changes</summary>
                <ActionForm action={reviewDesignAction} submitLabel="Send back to artist" danger className="mt-2">
                  <input type="hidden" name="designId" value={d.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <textarea name="note" required minLength={5} maxLength={500} className="input min-h-20" placeholder="What should the artist change? (e.g. photos are blurry, price doesn’t match the coverage)" aria-label="Note to artist" />
                </ActionForm>
              </details>
            </article>
            );
          })}
          {!designs.length && <p className="card p-8 text-center text-muted">No designs waiting for review.</p>}
        </section>
      )}
    </>
  );
}

export default function VerificationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return (
    <>
      <h1 className="text-[2.25rem] sm:text-4xl">Verification</h1>
      <p className="mt-1 text-sm text-muted">Approve new artists and their designs. Artists are emailed every decision.</p>
      <KeyedSuspense fallback={<AdaptiveSkeleton />}>
        <Queue searchParams={searchParams} />
      </KeyedSuspense>
    </>
  );
}
