"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { siteSignIn, useSiteAccount } from "./site-account";

const ICON: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  designs: (
    <>
      <path d="M12 3c3 3 5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 2-6 5-9Z" />
      <path d="M12 21v-6" />
    </>
  ),
  artists: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20v-.5A5.5 5.5 0 0 1 8 14h2a5.5 5.5 0 0 1 5.5 5.5v.5" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5 5 0 0 1 3.5 5v1" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </>
  ),
};

/**
 * Website bottom navigation on phones (hidden from md up, where the header shows everything). Home,
 * Designs, Artists and the account tab: "Log in" when signed out, the customer's name when signed in,
 * "Portal" for artists. Not shown during checkout (/book), which has its own sticky action bar.
 */
export function SiteTabBar() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const account = useSiteAccount();
  const [busy, setBusy] = useState(false);
  if (pathname.startsWith("/book/")) return null;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const first = account?.customer?.name?.trim().split(/\s+/)[0];
  const accountTab = account?.artist
    ? { href: "/artist-portal", label: "Portal", initial: account.artist.name.charAt(0).toUpperCase() }
    : account?.customer
      ? { href: "/account", label: first || "Account", initial: (first || account.customer.email || "A").charAt(0).toUpperCase() }
      : null;

  const item = (href: string, label: string, icon: React.ReactNode, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[0.72rem] font-semibold ${active ? "text-plum" : "text-muted"}`}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
      {active && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-plum" aria-hidden />}
    </Link>
  );
  const svg = (k: string, active: boolean) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICON[k]}
    </svg>
  );

  async function login() {
    setBusy(true);
    try {
      const done = await siteSignIn();
      if (!done) router.push("/account");
    } catch {
      router.push("/account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* keeps the page's last content clear of the bar */}
      <div className="h-[var(--tabbar-h)] md:hidden" aria-hidden />
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t hairline bg-ivory/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <ul className="mx-auto grid max-w-lg grid-cols-4">
          <li>{item("/", "Home", svg("home", isActive("/")), isActive("/"))}</li>
          <li>{item("/designs", "Designs", svg("designs", isActive("/designs")), isActive("/designs"))}</li>
          <li>{item("/artists", "Artists", svg("artists", isActive("/artists")), isActive("/artists"))}</li>
          <li>
            {accountTab ? (
              item(
                accountTab.href,
                accountTab.label,
                <span className={`grid h-6 w-6 place-items-center rounded-full text-[0.7rem] font-bold ${isActive(accountTab.href) ? "bg-plum text-ivory" : "bg-blush text-plum"}`} aria-hidden>
                  {accountTab.initial}
                </span>,
                isActive(accountTab.href),
              )
            ) : (
              <button
                type="button"
                onClick={login}
                disabled={busy || account === null}
                className={`relative flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold ${isActive("/account") ? "text-plum" : "text-muted"}`}
              >
                {svg("account", isActive("/account"))}
                {busy ? "Opening…" : "Log in"}
              </button>
            )}
          </li>
        </ul>
      </nav>
    </>
  );
}
