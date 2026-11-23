"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const SECONDARY = [
  { href: "/booking/find", label: "Find my booking" },
  { href: "/contact", label: "Contact" },
  { href: "/about", label: "About" },
];

export function MobileNavigation({ items }: { items: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    // The menu is hidden from md up; close it if the screen rotates/resizes past that so the
    // page is not left scroll-locked behind an invisible panel.
    const mq = window.matchMedia("(min-width: 768px)");
    const onMq = () => mq.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="md:hidden">
      <button
        ref={button}
        type="button"
        className="btn btn-ghost h-11 w-11 p-0 -mr-2"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          {open ? (
            <path d="M5 5l12 12M17 5L5 17" />
          ) : (
            <>
              <path d="M3 7h16" />
              <path d="M3 15h10" />
            </>
          )}
        </svg>
      </button>
      {open && (
        <div
          id="mobile-menu"
          ref={panel}
          className="fixed inset-x-0 bottom-0 z-50 overflow-y-auto overscroll-contain bg-ivory"
          style={{ top: "var(--header-h)", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <nav aria-label="Mobile" className="container-v flex min-h-full flex-col pb-6 pt-2">
            <ul>
              {items.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} onClick={close} className="flex min-h-14 items-center border-b hairline font-display text-[1.65rem] text-plum">
                    {n.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/become-an-artist" onClick={close} className="flex min-h-14 items-center border-b hairline font-display text-[1.65rem] text-plum">
                  Become an artist
                </Link>
              </li>
            </ul>
            <ul className="mt-3 flex flex-wrap gap-x-5">
              {SECONDARY.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} onClick={close} className="tap-link text-[0.95rem] text-plum-ink/80 underline decoration-rose underline-offset-4">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
            {/* Pinned to the bottom of the sheet, where a thumb reaches it. */}
            <div className="mt-auto pt-6">
              <Link href="/designs" onClick={close} className="btn btn-primary w-full">
                Book an artist
              </Link>
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
