import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireRole } from "@/server/auth";
import { logoutAction } from "../actions";
import { AdminNav } from "@/components/admin/AdminNav";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · VAISHORA Admin" }, robots: { index: false, follow: false } };

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/designs", label: "Designs" },
  { href: "/admin/artists", label: "Artists" },
  { href: "/admin/pricing", label: "Pricing & settings", admin: true },
  { href: "/admin/customers", label: "Customers & inbox" },
  { href: "/admin/reviews", label: "Reviews" },
];

async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  const user = await requireRole(["admin", "staff"]);
  return (
    <div className="min-h-dvh bg-[#fbf5f3]">
      <header className="border-b hairline bg-plum text-ivory">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 pt-2 pb-1 md:py-3">
          <Link href="/admin" className="flex min-h-11 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/emblem.png" alt="" className="h-7 w-auto" />
            <span className="font-display text-xl">Admin</span>
          </Link>
          <AdminNav items={NAV.filter((n) => !n.admin || user.role === "admin")} />
          <div className="ml-auto flex items-center gap-1 text-sm sm:gap-3">
            <span className="hidden text-blush/80 lg:inline">
              {user.name} · {user.role}
            </span>
            <Link href="/" className="inline-flex min-h-11 items-center px-2 text-blush/80 hover:text-ivory">
              View site
            </Link>
            <form action={logoutAction}>
              <button className="min-h-11 rounded-[var(--radius-sm)] border border-white/20 px-3 hover:bg-white/10">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] md:py-8">{children}</main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-8 text-muted">Loading…</div>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
