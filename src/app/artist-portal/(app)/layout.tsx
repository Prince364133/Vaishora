import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireArtist } from "@/server/artist-auth";
import { getDb } from "@/server/db";
import { PortalSideNav, PortalTabBar } from "@/components/artist/PortalNav";
import { initials } from "@/components/artists/ArtistCard";
import { AdaptiveSkeleton } from "@/components/artist/AdaptiveSkeleton";
import { artistSignOutAction } from "../actions";

export const metadata: Metadata = { title: { default: "Artist portal", template: "%s · VAISHORA Artist" }, robots: { index: false, follow: false } };

const STATUS_LABEL = { pending: "Pending verification", active: "Verified artist", suspended: "Account paused", rejected: "Not approved" } as const;

async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  const a = await requireArtist();
  const db = await getDb();
  const [badge] = await db.query<{ orders: number; tickets: number }>(
    `SELECT (SELECT count(*)::int FROM bookings WHERE artist_id = $1 AND status = 'awaiting_artist_confirmation') AS orders,
            (SELECT count(*)::int FROM support_tickets WHERE artist_id = $1 AND status = 'awaiting_reply') AS tickets`,
    [a.id],
  );
  const badges = { orders: badge.orders, profile: badge.tickets };
  const avatar = (size: string) =>
    a.photo_url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={a.photo_url} alt="" className={`${size} flex-none rounded-full object-cover ring-2 ring-gold/50`} />
    ) : (
      <span className={`grid ${size} flex-none place-items-center rounded-full bg-rose text-sm font-semibold text-plum-ink`} aria-hidden>
        {initials(a.name)}
      </span>
    );
  return (
    <div className="min-h-dvh bg-[#fbf5f3] pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0 md:pl-64">
      {/* Desktop and tablets: side menu */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-plum text-ivory md:flex">
        <Link href="/artist-portal" className="flex min-h-16 items-center gap-2 border-b border-white/10 px-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/emblem.png" alt="" className="h-7 w-auto" />
          <span className="font-display text-xl">Artist</span>
        </Link>
        <PortalSideNav badges={badges} />
        <div className="space-y-3 border-t border-white/10 p-4 text-sm">
          <Link href="/artist-portal/profile" className="flex items-center gap-3">
            {avatar("h-10 w-10")}
            <span className="min-w-0">
              <span className="block truncate font-semibold">{a.name}</span>
              <span className="block truncate text-xs text-blush/80">{STATUS_LABEL[a.status]}</span>
            </span>
          </Link>
          <Link href="/" className="block text-blush/80 hover:text-ivory">
            VAISHORA website ↗
          </Link>
          <form action={artistSignOutAction}>
            <button className="min-h-10 w-full rounded-[var(--radius-sm)] border border-white/20 px-3 hover:bg-white/10">Sign out</button>
          </form>
        </div>
      </aside>

      {/* Phones: compact top bar + bottom tab bar */}
      <header className="sticky top-0 z-30 bg-plum pt-[env(safe-area-inset-top)] text-ivory shadow-sm md:hidden">
        <div className="flex items-center gap-4 px-4 py-2">
          <Link href="/artist-portal" className="flex min-h-11 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/emblem.png" alt="" className="h-7 w-auto" />
            <span className="font-display text-xl">Artist</span>
          </Link>
          <Link href="/artist-portal/profile" className="ml-auto flex min-h-11 items-center" aria-label="Your profile">
            {avatar("h-9 w-9")}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-5 pb-8 md:px-8 md:pt-10 lg:max-w-4xl">{children}</main>
      <PortalTabBar badges={badges} />
    </div>
  );
}

export default function ArtistPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-[#fbf5f3] md:pl-64">
          <div className="fixed inset-y-0 left-0 hidden w-64 bg-plum md:block" aria-hidden />
          <div className="h-14 bg-plum md:hidden" aria-hidden />
          <div className="mx-auto max-w-3xl px-4 pt-5 md:px-8 md:pt-10 lg:max-w-4xl">
            <AdaptiveSkeleton />
          </div>
        </div>
      }
    >
      <Shell>{children}</Shell>
    </Suspense>
  );
}
