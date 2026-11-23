import Link from "next/link";
import { MobileNavigation } from "./MobileNavigation";

export const NAV = [
  { href: "/designs", label: "Designs" },
  { href: "/#services", label: "Services" },
  { href: "/artists", label: "Artists" },
  { href: "/#how-it-works", label: "How it works" },
];

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex min-h-11 items-center gap-2.5 ${className}`} aria-label="VAISHORA home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/emblem.png" alt="" width={30} height={28} className="h-7 w-auto" />
      <span className="wordmark h-[14px] w-[124px] min-[360px]:h-[15px] min-[360px]:w-[136px]" aria-hidden />
    </Link>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b hairline" style={{ height: "var(--header-h)" }}>
      {/* The blur lives on its own layer: backdrop-filter on the header itself would become the
          containing block for the fixed mobile menu and collapse it to the header's height. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-ivory/92 backdrop-blur-md" />
      <div className="container-v flex h-full items-center justify-between gap-3">
        <Logo />
        <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="btn-ghost btn text-[0.9rem] font-medium">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/account" className="btn btn-ghost btn-sm hidden px-3 text-sm sm:inline-flex">
            My bookings
          </Link>
          <Link href="/designs" className="btn btn-primary btn-sm hidden sm:inline-flex">
            Book an artist
          </Link>
          <MobileNavigation items={NAV} />
        </div>
      </div>
    </header>
  );
}
