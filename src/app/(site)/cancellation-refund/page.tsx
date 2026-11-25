import { Suspense } from "react";
import { LegalPage } from "@/components/site/LegalPage";
import { cachedSettings } from "@/server/cached";
import { AdaptiveSkeleton } from "@/components/site/AdaptiveSkeleton";

export const metadata = { title: "Cancellation and refund policy" };

async function Policy() {
  const s = await cachedSettings();
  const c = s.cancellation;
  return (
    <>
      <h2>Advance payment</h2>
      <p>To reserve a slot you pay an advance of {s.advance_percent}% of the booking total online. The balance is paid to the artist after the session. Unpaid bookings are released after {s.hold_minutes} minutes.</p>
      <h2>If you cancel</h2>
      <ul>
        <li>{c.full_refund_hours} hours or more before the start time: full refund of the advance.</li>
        <li>Between {c.partial_refund_hours} and {c.full_refund_hours} hours before: {c.partial_refund_percent}% of the advance is refunded.</li>
        <li>Less than {c.partial_refund_hours} hours before, or if the artist is turned away at the door: no refund.</li>
      </ul>
      <p>You can cancel from your booking page or by contacting us with your booking ID.</p>
      <h2>If we cancel</h2>
      <ul>
        <li>If we cannot confirm an artist, or an artist cancels and we cannot find a replacement you accept, you get a full refund of the advance.</li>
        <li>Rescheduling is subject to artist availability; contact us as early as possible.</li>
      </ul>
      <h2>How refunds are paid</h2>
      <p>Refunds go back to the original payment method through our payment partner. Banks typically take 5–7 working days to credit a refund after it is processed.</p>
    </>
  );
}

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Cancellation and refund policy">
      <Suspense fallback={<AdaptiveSkeleton />}>
        <Policy />
      </Suspense>
    </LegalPage>
  );
}
