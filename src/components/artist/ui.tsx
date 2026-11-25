import Link from "next/link";
import { formatPhone } from "@/lib/format";

export function PageHeader({ title, subtitle, back, action }: { title: string; subtitle?: React.ReactNode; back?: { href: string; label: string }; action?: React.ReactNode }) {
  return (
    <div className="mb-5">
      {back && (
        <Link href={back.href} className="link tap-link mb-1 inline-flex text-sm">
          ← {back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-[2.1rem] leading-tight sm:text-4xl">{title}</h1>
        {action}
      </div>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

export function StatTile({ label, value, hint, href, tone = "plain" }: { label: string; value: string; hint?: string; href?: string; tone?: "plain" | "plum" }) {
  const body = (
    <>
      <p className={`text-xs ${tone === "plum" ? "text-blush" : "text-muted"}`}>{label}</p>
      <p className={`mt-1 text-[1.45rem] font-semibold tabular-nums leading-tight sm:text-2xl ${tone === "plum" ? "text-ivory" : "text-plum"}`}>{value}</p>
      {hint && <p className={`mt-0.5 text-xs ${tone === "plum" ? "text-blush/90" : "text-muted"}`}>{hint}</p>}
    </>
  );
  const cls = `block rounded-[var(--radius-md)] p-4 ${tone === "plum" ? "bg-plum" : "card"}`;
  return href ? (
    <Link href={href} className={`${cls} transition-shadow hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const TONES = {
  neutral: "bg-blush text-plum",
  success: "bg-[#e6f2ea] text-success",
  warning: "bg-gold/25 text-henna",
  danger: "bg-[#f6e3e3] text-danger",
} as const;

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="card px-5 py-10 text-center">
      <p className="font-display text-2xl text-plum">{title}</p>
      {text && <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SupportContact({ phone, compact = false }: { phone: string; compact?: boolean }) {
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-4"}`}>
      {phone && (
        <a href={`tel:${phone}`} className="btn btn-secondary btn-sm">
          Call {formatPhone(phone)}
        </a>
      )}
      <Link href="/artist-portal/support" className="btn btn-ghost btn-sm">
        Raise a support ticket
      </Link>
    </div>
  );
}

/** Shown on pages that need an approved account. */
export function NotActiveNotice({ status, phone }: { status: string; phone: string }) {
  const text =
    status === "pending"
      ? "This section opens as soon as your artist account is verified. Meanwhile you can complete your profile, working hours and bank details."
      : status === "suspended"
        ? "Your artist account is paused. Please contact support to restore it."
        : "Your application was not approved. Please contact support if you have questions.";
  return (
    <div className="card p-5">
      <p className="font-display text-2xl text-plum">{status === "pending" ? "Available after verification" : "Account not active"}</p>
      <p className="mt-2 text-sm text-muted">{text}</p>
      <SupportContact phone={phone} />
    </div>
  );
}

/** Design moderation / availability badge. */
export function reviewBadge(d: { review_status: string; status: string; has_pending?: boolean }) {
  if (d.review_status === "pending") return <Badge tone="warning">In review</Badge>;
  if (d.review_status === "rejected") return <Badge tone="danger">Changes needed</Badge>;
  if (d.has_pending) return <Badge tone="warning">{d.status === "active" ? "Live · edit in review" : "Hidden · edit in review"}</Badge>;
  if (d.status === "unavailable") return <Badge>Hidden</Badge>;
  if (d.status === "draft") return <Badge>Archived</Badge>;
  return <Badge tone="success">Live</Badge>;
}

export const ticketTone = (s: string): keyof typeof TONES => (s === "awaiting_reply" ? "warning" : s === "resolved" || s === "closed" ? "success" : "neutral");
