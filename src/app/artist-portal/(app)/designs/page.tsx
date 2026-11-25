import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireArtist } from "@/server/artist-auth";
import { getDb } from "@/server/db";
import { listArtistDesigns } from "@/server/artist-portal";
import { cachedSettings } from "@/server/cached";
import { EmptyState, NotActiveNotice, PageHeader, reviewBadge } from "@/components/artist/ui";
import { formatPaise } from "@/lib/money";
import { formatDuration } from "@/lib/time";
import { AdaptiveSkeleton } from "@/components/artist/AdaptiveSkeleton";

export const metadata: Metadata = { title: "Designs" };

async function Designs({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  await connection();
  const a = await requireArtist();
  const settings = await cachedSettings();
  if (a.status !== "active")
    return (
      <>
        <PageHeader title="Designs" />
        <NotActiveNotice status={a.status} phone={settings.support.phone} />
      </>
    );
  const [{ deleted }, designs] = await Promise.all([searchParams, listArtistDesigns(await getDb(), a.id)]);
  const add = (
    <Link href="/artist-portal/designs/new" className="btn btn-primary btn-sm flex-none">
      + Add design
    </Link>
  );
  return (
    <>
      <PageHeader title="Designs" subtitle="Each design shows on your profile and can be booked with you once approved." action={designs.length ? add : undefined} />
      {deleted && (
        <p className="mb-4 text-sm text-success" role="status">
          Design removed.
        </p>
      )}
      {!designs.length ? (
        <EmptyState title="Add your first design" text="Upload photos of your work, set your price and how long it takes. Customers book it straight into your free slots." action={add} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {designs.map((d) => (
            <li key={d.id}>
              <Link href={`/artist-portal/designs/${d.id}`} className="card flex gap-3 overflow-hidden p-3 transition-shadow hover:shadow-md">
                {d.photos[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.photos[0].url} alt="" loading="lazy" decoding="async" className="h-24 w-24 flex-none rounded-[var(--radius-sm)] object-cover" />
                ) : (
                  <span className="h-24 w-24 flex-none rounded-[var(--radius-sm)] bg-blush" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 font-semibold text-plum-ink">{d.name}</p>
                  </div>
                  <p className="mt-0.5 text-sm text-muted">
                    {formatPaise(d.base_price_paise)} · {formatDuration(d.duration_minutes)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {reviewBadge(d)}
                    {d.bookings > 0 && <span className="text-xs text-muted">{d.bookings} booking{d.bookings > 1 ? "s" : ""}</span>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function DesignsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <Designs searchParams={searchParams} />
    </Suspense>
  );
}
