import Link from "next/link";
import type { Customer } from "@/server/customer-auth";
import { formatPhone } from "@/lib/format";

const TABS = [
  { key: "bookings", href: "/account", label: "Bookings" },
  { key: "addresses", href: "/account/addresses", label: "Addresses" },
  { key: "support", href: "/account/support", label: "Support" },
  { key: "profile", href: "/account/profile", label: "Profile" },
] as const;

export type AccountTab = (typeof TABS)[number]["key"];

/** Customer account frame: who is signed in, and the four sections. */
export function AccountShell({ customer, tab, children, badge = {} }: { customer: Customer; tab: AccountTab; children: React.ReactNode; badge?: Partial<Record<AccountTab, number>> }) {
  const initial = (customer.name || customer.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="container-v max-w-3xl pt-5 pb-10 md:py-10">
      <div className="flex items-center gap-4">
        <span className="grid h-14 w-14 flex-none place-items-center rounded-full bg-plum font-display text-2xl text-ivory" aria-hidden>
          {initial}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[2rem] leading-tight md:text-4xl">{customer.name || "My account"}</h1>
          <p className="truncate text-sm text-muted">{[customer.phone ? formatPhone(customer.phone) : null, customer.email].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <nav className="mt-5 grid grid-cols-4 gap-1 rounded-[var(--radius-md)] bg-blush p-1" aria-label="My account">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={tab === t.key ? "page" : undefined}
            className={`relative flex min-h-11 items-center justify-center rounded-[var(--radius-sm)] px-1 text-[0.82rem] font-semibold sm:text-sm ${tab === t.key ? "bg-white text-plum shadow-sm" : "text-muted"}`}
          >
            {t.label}
            {!!badge[t.key] && <span className="ml-1 rounded-full bg-rose-deep px-1.5 text-[0.68rem] leading-5 text-ivory">{badge[t.key]}</span>}
          </Link>
        ))}
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}
