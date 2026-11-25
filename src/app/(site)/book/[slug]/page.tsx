import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { cachedDesigns, cachedLocalities, cachedPricingRules, cachedSettings } from "@/server/cached";
import type { StudioDesign } from "@/components/studio/types";
import { AdaptiveSkeleton } from "@/components/site/AdaptiveSkeleton";

export const metadata: Metadata = { title: "Book a mehndi artist", robots: { index: false } };

async function Flow({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [designs, rules, localities, settings] = await Promise.all([cachedDesigns(), cachedPricingRules(), cachedLocalities(), cachedSettings()]);
  const design = (designs as StudioDesign[]).find((d) => d.slug === slug);
  if (!design) notFound();
  return (
    <BookingFlow
      design={design}
      rules={rules.map((r) => ({ code: r.code, group_code: r.group_code, label: r.label, description: r.description, is_default: r.is_default }))}
      localities={localities.map((l) => ({ id: l.id, name: l.name }))}
      policy={{
        advancePercent: settings.advance_percent,
        holdMinutes: settings.hold_minutes,
        fullRefundHours: settings.cancellation.full_refund_hours,
        partialRefundHours: settings.cancellation.partial_refund_hours,
        partialRefundPercent: settings.cancellation.partial_refund_percent,
        bookingWindowDays: settings.booking_window_days,
      }}
    />
  );
}

export default function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <Flow params={params} />
    </Suspense>
  );
}
