import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import type { Metadata } from "next";
import { getBookingByToken, refundEntitlement } from "@/server/bookings";
import { getSettings } from "@/server/settings";
import { expireStaleHolds } from "@/server/availability";
import { getDb } from "@/server/db";
import { STATUS_LABEL, STATUS_NEXT_STEP } from "@/lib/booking-status";
import { formatPaise } from "@/lib/money";
import { formatDuration, formatIstDate, formatIstTime } from "@/lib/time";
import { HandIllustration } from "@/components/hand/HandIllustration";
import { PaymentPanel } from "@/components/booking/PaymentPanel";
import { CancelBooking } from "@/components/booking/CancelBooking";
import { ReviewForm } from "@/components/booking/ReviewForm";

export const metadata: Metadata = { title: "Your booking", robots: { index: false, follow: false } };

const CUSTOMER_CANCELLABLE = ["pending_payment", "awaiting_artist_assignment", "awaiting_artist_confirmation", "confirmed"];

async function BookingDetails({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ new?: string }> }) {
  await connection();
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  await expireStaleHolds(await getDb());
  const b = await getBookingByToken(token);
  if (!b) notFound();
  const settings = await getSettings();
  const paid = b.paid_paise > 0;
  const confirmedish = ["awaiting_artist_assignment", "awaiting_artist_confirmation", "confirmed", "in_progress", "completed"].includes(b.status);
  const ent = refundEntitlement(b, settings);
  const art = b.design_region === "feet" ? b.design_assets.feet : b.design_assets.palm ?? b.design_assets.back;
  const side = b.design_region === "feet" ? "feet" : b.design_assets.palm ? "palm" : "back";
  const support = settings.support;

  return (
    <div className="container-v max-w-3xl py-8 md:py-12">
      {confirmedish && sp.new && (
        <p className="mb-4 rounded-[var(--radius-sm)] bg-success/10 px-4 py-3 text-sm font-semibold text-success" role="status">
          Payment received. Your booking is recorded.
        </p>
      )}
      <p className="text-sm text-muted">Booking ID</p>
      <h1 className="text-4xl md:text-5xl tracking-wide">{b.code}</h1>
      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-blush px-3 py-1 text-sm font-semibold text-plum">{STATUS_LABEL[b.status]}</div>
      <p className="mt-3 max-w-xl text-muted">{STATUS_NEXT_STEP[b.status]}</p>

      {b.status === "pending_payment" && (
        <div className="mt-6">
          <PaymentPanel token={token} advancePaise={b.advance_paise} holdExpiresAt={b.hold_expires_at} supportWhatsapp={support.whatsapp} />
        </div>
      )}

      <div className="mt-8 grid gap-6 sm:grid-cols-[160px_1fr]">
        <div className="rounded-[var(--radius-md)] bg-blush/70">
          <HandIllustration side={side} art={art ?? null} label={`${b.design_name} design`} />
        </div>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Design</dt>
            <dd className="font-semibold">{b.design_name}</dd>
          </div>
          <div>
            <dt className="text-muted">Date</dt>
            <dd className="font-semibold">{formatIstDate(b.starts_at, true)}</dd>
          </div>
          <div>
            <dt className="text-muted">Time (IST)</dt>
            <dd className="font-semibold">
              {formatIstTime(b.starts_at)} – {formatIstTime(b.ends_at)} <span className="font-normal text-muted">({formatDuration(b.duration_minutes)})</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted">Artist</dt>
            <dd className="font-semibold">{b.status === "confirmed" || b.status === "in_progress" || b.status === "completed" ? b.artist_name : "Shown once the artist confirms"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted">Address</dt>
            <dd>
              {b.address_line}, {b.locality}, {b.city}
              {b.landmark ? ` — near ${b.landmark}` : ""}
            </dd>
          </div>
        </dl>
      </div>

      <section className="mt-8 card p-5" aria-label="Payment summary">
        <ul className="space-y-1.5 text-sm">
          {b.items.map((i, k) => (
            <li key={k} className="flex justify-between gap-4">
              <span className="text-muted">{i.label}</span>
              <span>{i.amount_paise < 0 ? "−" : ""}{formatPaise(Math.abs(i.amount_paise))}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t hairline pt-3 font-semibold">
          <span>Total</span>
          <span>{formatPaise(b.total_paise)}</span>
        </div>
        <div className="mt-1 flex justify-between text-sm">
          <span className="text-muted">Advance {paid ? "paid" : "due now"}</span>
          <span>{formatPaise(paid ? b.paid_paise : b.advance_paise)}</span>
        </div>
        {b.refunded_paise > 0 && (
          <div className="mt-1 flex justify-between text-sm text-success">
            <span>Refund</span>
            <span>{formatPaise(b.refunded_paise)}</span>
          </div>
        )}
        <div className="mt-1 flex justify-between text-sm">
          <span className="text-muted">Payment status</span>
          <span>{b.refunded_paise > 0 ? (b.status === "refunded" ? "Refunded" : "Refund in progress") : paid ? "Paid" : b.status === "expired" || b.status === "cancelled" ? "Not paid" : "Awaiting payment"}</span>
        </div>
        {paid && b.total_paise > b.paid_paise && !["cancelled", "refund_pending", "refunded"].includes(b.status) && (
          <p className="mt-2 text-sm text-muted">Balance of {formatPaise(b.total_paise - b.advance_paise)} is paid to the artist after the session.</p>
        )}
      </section>

      {b.status === "completed" && !b.has_review && (
        <div className="mt-8">
          <ReviewForm token={token} />
        </div>
      )}

      <section className="mt-8 space-y-3">
        <h2 className="text-2xl">Need help?</h2>
        <p className="text-sm text-muted">
          Quote your booking ID <span className="font-semibold text-plum-ink">{b.code}</span>.{" "}
          {support.whatsapp && (
            <a className="link" href={`https://wa.me/${support.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Booking ${b.code}`)}`} target="_blank" rel="noopener">
              WhatsApp us
            </a>
          )}
          {support.whatsapp && " · "}
          <Link className="link" href={`/contact?booking=${b.code}`}>
            Contact support
          </Link>
          {support.hours && <> · {support.hours}</>}
        </p>
        <p className="text-sm text-muted">Keep this page’s link private. Anyone with it can view this booking.</p>
        {CUSTOMER_CANCELLABLE.includes(b.status) && <CancelBooking token={token} refundPaise={ent.amount} paid={paid} />}
      </section>

      {(b.status === "expired" || b.status === "cancelled") && (
        <Link href={`/book/${b.design_slug}`} className="btn btn-primary mt-8">
          Book again
        </Link>
      )}
    </div>
  );
}

export default function BookingPage(props: { params: Promise<{ token: string }>; searchParams: Promise<{ new?: string }> }) {
  return (
    <Suspense fallback={<div className="container-v py-16 text-muted">Loading your booking…</div>}>
      <BookingDetails {...props} />
    </Suspense>
  );
}
