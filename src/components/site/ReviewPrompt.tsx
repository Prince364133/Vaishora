"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSiteAccount } from "./site-account";

type Due = { token: string; design: string; artist: string; starts_at: string; photo: string | null };

/**
 * After a booked time is over, the signed-in customer is asked once to rate their artist: tap a star (opens the
 * rating page with it pre-selected) or Skip (never asked about that booking again). Not shown while booking,
 * on the rating page itself, or inside a support conversation.
 */
export function ReviewPrompt() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const account = useSiteAccount();
  const [due, setDue] = useState<Due | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = /^\/(book|review|booking|account\/support)(\/|$)/.test(pathname);

  useEffect(() => {
    if (!account?.customer || blocked) return;
    let live = true;
    fetch("/api/reviews/due", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { due: Due | null }) => live && setDue(j.due))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [account?.customer, blocked]);

  if (!due || blocked) return null;
  const first = due.artist.split(" ")[0];

  async function skip() {
    setBusy(true);
    await fetch("/api/reviews/skip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: due!.token }) }).catch(() => {});
    setDue(null);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="rate-title" className="fixed inset-0 z-[65] flex items-end justify-center bg-plum-ink/45 sm:items-center sm:p-6">
      <div className="w-full max-w-md rounded-t-[var(--radius-lg)] bg-ivory p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[var(--radius-lg)]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-plum/15 sm:hidden" aria-hidden />
        <div className="flex items-center gap-3">
          {due.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={due.photo} alt="" className="h-14 w-14 flex-none rounded-[var(--radius-sm)] object-cover" />
          ) : (
            <span className="grid h-14 w-14 flex-none place-items-center rounded-[var(--radius-sm)] bg-blush text-2xl text-gold" aria-hidden>
              ★
            </span>
          )}
          <div className="min-w-0">
            <h2 id="rate-title" className="text-2xl leading-tight">
              How was your mehndi with {first}?
            </h2>
            <p className="truncate text-sm text-muted">{due.design}</p>
          </div>
        </div>
        <div role="radiogroup" aria-label="Rating" className="mt-4 flex justify-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                router.push(`/review/${due.token}?rating=${n}`);
              }}
              className="grid h-14 w-14 place-items-center text-[2.4rem] text-gold/35 transition-colors hover:text-gold active:scale-90"
            >
              ★
            </button>
          ))}
        </div>
        <p className="mt-1 text-center text-xs text-muted">Tap a star to rate</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-secondary" onClick={skip} disabled={busy}>
            Skip
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              router.push(`/review/${due.token}`);
            }}
          >
            Rate now
          </button>
        </div>
      </div>
    </div>
  );
}
