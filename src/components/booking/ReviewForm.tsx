"use client";

import { useState } from "react";

const WORDS = ["", "Poor", "Okay", "Good", "Great", "Loved it!"];

/**
 * Rate the artist for a booking: stars (required), an optional comment, and — where offered — "Skip".
 * `initialRating` pre-selects the stars chosen in the in-app prompt or the email.
 */
export function ReviewForm({
  token,
  artistName,
  initialRating = 0,
  allowSkip = false,
  onDone,
}: {
  token: string;
  artistName?: string | null;
  initialRating?: number;
  allowSkip?: boolean;
  onDone?: (outcome: "rated" | "skipped") => void;
}) {
  const [rating, setRating] = useState(Math.max(0, Math.min(5, initialRating)));
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "rated" | "skipped">("idle");
  const [error, setError] = useState("");
  const first = artistName?.split(" ")[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return setError("Tap a star to rate.");
    setState("sending");
    setError("");
    const res = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, rating, body }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("idle");
      setError(json.error ?? "Could not send your rating");
      return;
    }
    setState("rated");
    onDone?.("rated");
  }

  async function skip() {
    setState("sending");
    await fetch("/api/reviews/skip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => {});
    setState("skipped");
    onDone?.("skipped");
  }

  if (state === "rated")
    return (
      <p className="card p-5 text-success" role="status">
        Thank you{first ? ` — we’ll pass it on to ${first}` : ""}! Your review appears on the site after a quick check.
      </p>
    );
  if (state === "skipped")
    return (
      <p className="card p-5 text-muted" role="status">
        No problem — we won’t ask about this booking again.
      </p>
    );

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div>
        <h2 className="font-sans text-lg font-semibold text-plum-ink">{first ? `How was your mehndi with ${first}?` : "How was your mehndi?"}</h2>
        <p className="text-sm text-muted">Your rating helps other customers choose and helps your artist grow.</p>
      </div>
      <div>
        <div role="radiogroup" aria-label="Rating" className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              onClick={() => {
                setRating(n);
                setError("");
              }}
              className={`grid h-12 w-12 place-items-center text-[2rem] transition-transform active:scale-90 ${n <= rating ? "text-gold" : "text-gold/30"}`}
            >
              ★
            </button>
          ))}
        </div>
        <p className="mt-1 h-5 text-sm font-semibold text-plum">{WORDS[rating]}</p>
      </div>
      <label className="field">
        <span className="label">
          Tell us more <span className="font-normal text-muted">(optional)</span>
        </span>
        <textarea className="input min-h-24" maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The design, the colour, the artist’s punctuality…" />
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Submit rating"}
        </button>
        {allowSkip && (
          <button type="button" className="btn btn-ghost" onClick={skip} disabled={state === "sending"}>
            Skip
          </button>
        )}
      </div>
    </form>
  );
}
