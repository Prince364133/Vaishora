"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  orders: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  designs: (
    <>
      <path d="M12 3c3 3 5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 2-6 5-9Z" />
      <path d="M12 21v-6" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </>
  ),
};

export const PORTAL_TABS = [
  { href: "/artist-portal", label: "Home", icon: "home" },
  { href: "/artist-portal/orders", label: "Orders", icon: "orders" },
  { href: "/artist-portal/designs", label: "Designs", icon: "designs" },
  { href: "/artist-portal/profile", label: "Profile", icon: "profile" },
] as const;

// Pages reached from Home/Profile highlight the tab they belong to.
const OWNER: Record<string, string> = { "/artist-portal/payouts": "/artist-portal", "/artist-portal/schedule": "/artist-portal/profile", "/artist-portal/support": "/artist-portal/profile" };

function useActive() {
  const pathname = usePathname();
  const owner = Object.entries(OWNER).find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1];
  return (href: string) => {
    if (owner) return owner === href;
    return href === "/artist-portal" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  };
}

/** Bottom tab bar on phones (thumb reach, safe-area aware). */
export function PortalTabBar({ badges = {} }: { badges?: Record<string, number> }) {
  const isActive = useActive();
  return (
    <nav
      aria-label="Artist portal"
      className="fixed inset-x-0 bottom-0 z-40 border-t hairline bg-ivory/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {PORTAL_TABS.map((t) => {
          const active = isActive(t.href);
          const badge = badges[t.icon] ?? 0;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-16 flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold ${active ? "text-plum" : "text-muted"}`}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {ICONS[t.icon]}
                </svg>
                {t.label}
                {badge > 0 && (
                  <span className="absolute top-2 left-[calc(50%+6px)] min-w-5 rounded-full bg-rose-deep px-1.5 text-center text-[0.68rem] leading-5 text-ivory" aria-label={`${badge} need attention`}>
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
                {active && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-plum" aria-hidden />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const MORE_ICONS: Record<string, React.ReactNode> = {
  payouts: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  schedule: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  support: (
    <>
      <path d="M4 5h16v11H8l-4 4z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
};

const MORE = [
  { href: "/artist-portal/payouts", label: "Payouts", icon: "payouts" },
  { href: "/artist-portal/schedule", label: "Working hours", icon: "schedule" },
  { href: "/artist-portal/support", label: "Support", icon: "support" },
] as const;

/** Desktop side menu: the four tabs, then shortcuts. */
export function PortalSideNav({ badges = {} }: { badges?: Record<string, number> }) {
  const pathname = usePathname();
  const isActive = useActive();
  const item = (href: string, label: string, icon: React.ReactNode, active: boolean, badge = 0) => (
    <li key={href}>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 text-sm transition-colors ${
          active ? "bg-white/14 font-semibold text-ivory shadow-[inset_3px_0_0_var(--color-gold)]" : "text-blush hover:bg-white/8 hover:text-ivory"
        }`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {icon}
        </svg>
        <span className="flex-1">{label}</span>
        {badge > 0 && <span className="rounded-full bg-gold px-1.5 text-xs leading-5 font-semibold text-plum-ink">{badge}</span>}
      </Link>
    </li>
  );
  return (
    <nav aria-label="Artist portal" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      <ul className="space-y-0.5">{PORTAL_TABS.map((t) => item(t.href, t.label, ICONS[t.icon], isActive(t.href) && !MORE.some((m) => pathname.startsWith(m.href)), badges[t.icon]))}</ul>
      <div>
        <p className="px-3 pb-1 text-[0.68rem] font-semibold tracking-[0.14em] text-blush/60 uppercase">Manage</p>
        <ul className="space-y-0.5">{MORE.map((m) => item(m.href, m.label, MORE_ICONS[m.icon], pathname.startsWith(m.href), m.icon === "support" ? badges.profile : 0))}</ul>
      </div>
    </nav>
  );
}
