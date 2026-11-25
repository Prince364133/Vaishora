import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { getBookingByToken } from "@/server/bookings";
import { reviewState } from "@/server/reviews";
import { ReviewForm } from "@/components/booking/ReviewForm";
import { AdaptiveSkeleton } from "@/components/site/AdaptiveSkeleton";
import { formatIstDate, formatIstTime } from "@/lib/time";

export const metadata: Metadata = { title: "Rate your artist", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ rating?: string }> };

/** "Rate your artist" — opened from the email or the in-app prompt. Rate (stars + optional comment) or skip. */
async function Review({ params, searchParams }: Props) {
  await connection();
  const [{ token }, { rating }] = await Promise.all([params, searchParams]);
  const b = await getBookingByToken(token);
  if (!b) notFound();
  const db = await getDb();
  const state = await reviewState(db, b.id);
  const photo = (await db.query<{ url: string }>(`SELECT p.url FROM design_photos p JOIN bookings x ON x.design_id = p.design_id WHERE x.id = $1 ORDER BY p.sort LIMIT 1`, [b.id]))[0]?.url;
  return (
    <div className="container-v max-w-xl py-8 md:py-14">
      <div className="card flex items-center gap-4 p-4">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="h-16 w-16 flex-none rounded-[var(--radius-sm)] object-cover" />
        ) : (
          <span className="grid h-16 w-16 flex-none place-items-center rounded-[var(--radius-sm)] bg-blush font-display text-2xl text-plum" aria-hidden>
            ★
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold text-plum-ink">{b.design_name}</p>
          <p className="text-sm text-muted">
            {b.artist_name ? `with ${b.artist_name} · ` : ""}
            {formatIstDate(b.starts_at)}, {formatIstTime(b.starts_at)}
          </p>
          <p className="text-xs text-muted">{b.code}</p>
        </div>
      </div>
      <div className="mt-5">
        {state === "allowed" ? (
          <ReviewForm token={token} artistName={b.artist_name} initialRating={Number(rating) || 0} allowSkip />
        ) : state === "done" ? (
          <p className="card p-5 text-success">You have already rated this booking — thank you!</p>
        ) : (
          <p className="card p-5 text-muted">You can rate your artist once your booked time is over. We’ll remind you.</p>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href={`/booking/${token}`} className="link">
          View booking
        </Link>
        <Link href="/designs" className="link">
          Book again
        </Link>
      </div>
    </div>
  );
}

export default function ReviewPage(props: Props) {
  return (
    <Suspense fallback={<AdaptiveSkeleton variant="account" />}>
      <Review {...props} />
    </Suspense>
  );
}
