import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { logoutAction } from "../actions";
import { AdminNav, AdminSideNav, NavItem } from "@/components/admin/AdminNav";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · VAISHORA Admin" }, robots: { index: false, follow: false } };

const NAV: (NavItem & { admin?: boolean; count?: "verification" | "payouts" | "support" | "bookings" })[] = [
  { href: "/admin", label: "Dashboard", section: "Overview" },
  { href: "/admin/verification", label: "Verification", section: "Operations", count: "verification" },
  { href: "/admin/bookings", label: "Bookings", section: "Operations", count: "bookings" },
  { href: "/admin/support", label: "Support", section: "Operations", count: "support" },
  { href: "/admin/payouts", label: "Payouts & margins", section: "Money", admin: true, count: "payouts" },
  { href: "/admin/artists", label: "Artists", section: "People" },
  { href: "/admin/customers", label: "Customers", section: "People" },
  { href: "/admin/designs", label: "Designs", section: "Catalogue" },
  { href: "/admin/pricing", label: "Pricing & settings", section: "Catalogue", admin: true },
  { href: "/admin/reviews", label: "Reviews", section: "Catalogue" },
];

async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  const user = await requireRole(["admin", "staff"]);
  const db = await getDb();
  const [c] = await db.query<{ verification: number; payouts: number; support: number; bookings: number }>(
    `SELECT (SELECT count(*)::int FROM artists WHERE status = 'pending')
          + (SELECT count(*)::int FROM designs WHERE review_status = 'pending' OR pending_changes IS NOT NULL) AS verification,
            (SELECT count(*)::int FROM payout_requests WHERE status IN ('requested','approved')) AS payouts,
            (SELECT count(*)::int FROM support_tickets WHERE status = 'open') AS support,
            (SELECT count(*)::int FROM bookings WHERE status IN ('awaiting_artist_assignment','awaiting_artist_confirmation')) AS bookings`,
  );
  const items: NavItem[] = NAV.filter((n) => !n.admin || user.role === "admin").map(({ href, label, section, count }) => ({ href, label, section, badge: count ? c[count] : 0 }));
  const signOut = (
    <form action={logoutAction}>
      <button className="min-h-10 w-full rounded-[var(--radius-sm)] border border-white/20 px-3 text-sm hover:bg-white/10">Sign out</button>
    </form>
  );
  return (
    <div className="min-h-dvh bg-[#fbf5f3] lg:pl-64">
      {/* Desktop: side menu */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-plum text-ivory lg:flex">
        <Link href="/admin" className="flex min-h-16 items-center gap-2 border-b border-white/10 px-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/emblem.png" alt="" className="h-7 w-auto" />
          <span className="font-display text-xl">Admin</span>
        </Link>
        <AdminSideNav items={items} />
        <div className="space-y-2 border-t border-white/10 p-4 text-sm">
          <p className="truncate text-blush/80">
            {user.name} · <span className="capitalize">{user.role}</span>
          </p>
          <Link href="/" className="block text-blush/80 hover:text-ivory">
            View site ↗
          </Link>
          {signOut}
        </div>
      </aside>

      {/* Phones and tablets: top bar with a swipeable section row */}
      <header className="border-b hairline bg-plum pt-[env(safe-area-inset-top)] text-ivory lg:hidden">
        <div className="mx-auto flex flex-wrap items-center gap-x-6 gap-y-1 px-4 pt-2 pb-1">
          <Link href="/admin" className="flex min-h-11 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/emblem.png" alt="" className="h-7 w-auto" />
            <span className="font-display text-xl">Admin</span>
          </Link>
          <div className="ml-auto flex items-center gap-1 text-sm">
            <Link href="/" className="inline-flex min-h-11 items-center px-2 text-blush/80 hover:text-ivory">
              View site
            </Link>
            <form action={logoutAction}>
              <button className="min-h-11 rounded-[var(--radius-sm)] border border-white/20 px-3 hover:bg-white/10">Sign out</button>
            </form>
          </div>
          <AdminNav items={items} />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-6 md:py-8 lg:px-8">{children}</main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-[#fbf5f3] lg:pl-64">
          <div className="fixed inset-y-0 left-0 hidden w-64 bg-plum lg:block" aria-hidden />
          <div className="h-16 bg-plum lg:hidden" aria-hidden />
          <div className="mx-auto max-w-7xl px-4 pt-5 md:px-6 md:py-8 lg:px-8">
            <AdaptiveSkeleton />
          </div>
        </div>
      }
    >
      <Shell>{children}</Shell>
    </Suspense>
  );
}
