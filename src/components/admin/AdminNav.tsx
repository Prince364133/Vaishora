"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export type NavItem = { href: string; label: string; section?: string; badge?: number };

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));
}

/** Phones and tablets: a swipeable row of links under the header (current page scrolled into view). */
export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  const isActive = useIsActive();

  useEffect(() => {
    nav.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <nav ref={nav} className="scroller order-3 -mx-4 w-[calc(100%+2rem)] gap-1 px-4 [scroll-padding-inline:16px] lg:hidden" aria-label="Admin">
      {items.map((n) => {
        const active = isActive(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-3 text-sm transition-colors ${
              active ? "bg-white/14 font-semibold text-ivory" : "text-blush hover:bg-white/10 hover:text-ivory"
            }`}
          >
            {n.label}
            {!!n.badge && <span className="rounded-full bg-gold px-1.5 text-xs leading-5 font-semibold text-plum-ink">{n.badge}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Desktop: grouped side menu. */
export function AdminSideNav({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();
  const sections = [...new Set(items.map((i) => i.section ?? ""))];
  return (
    <nav aria-label="Admin" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {sections.map((sec) => (
        <div key={sec}>
          {sec && <p className="px-3 pb-1 text-[0.68rem] font-semibold tracking-[0.14em] text-blush/60 uppercase">{sec}</p>}
          <ul className="space-y-0.5">
            {items
              .filter((i) => (i.section ?? "") === sec)
              .map((n) => {
                const active = isActive(n.href);
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-10 items-center justify-between gap-2 rounded-[var(--radius-sm)] px-3 text-sm transition-colors ${
                        active ? "bg-white/14 font-semibold text-ivory shadow-[inset_3px_0_0_var(--color-gold)]" : "text-blush hover:bg-white/8 hover:text-ivory"
                      }`}
                    >
                      {n.label}
                      {!!n.badge && <span className="rounded-full bg-gold px-1.5 text-xs leading-5 font-semibold text-plum-ink">{n.badge}</span>}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
