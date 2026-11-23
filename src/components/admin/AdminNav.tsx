"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Admin section links: a swipeable row on phones (current page scrolled into view), inline on desktop. */
export function AdminNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));

  useEffect(() => {
    nav.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <nav ref={nav} className="scroller order-3 -mx-4 w-[calc(100%+2rem)] gap-1 px-4 [scroll-padding-inline:16px] md:order-none md:mx-0 md:w-auto md:px-0" aria-label="Admin">
      {items.map((n) => {
        const active = isActive(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-[var(--radius-sm)] px-3 text-sm transition-colors ${
              active ? "bg-white/14 font-semibold text-ivory" : "text-blush hover:bg-white/10 hover:text-ivory"
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
