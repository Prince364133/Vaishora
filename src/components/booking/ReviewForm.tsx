"use client";

import { useState } from "react";

export function ReviewForm({ token }: { token: string }) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    const res = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, rating, body }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("idle");
      setError(json.error ?? "Could not send your review");
      return;
    }
    setState("done");
  }

  if (state === "done") return <p className="card p-5 text-success" role="status">Thank you! Your review will appear after a quick check.</p>;

  return (
    <form onSubmit={submit} className="card space-y-3 p-5">
      <h2 className="font-sans text-lg font-semibold text-plum-ink">How was your mehndi?</h2>
      <div role="radiogroup" aria-label="Rating" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => setRating(n)}
            className={`grid h-11 w-11 place-items-center text-2xl ${n <= rating ? "text-gold" : "text-gold/30"}`}
          >
            ★
          </button>
        ))}
      </div>
      <label className="field">
        <span className="label">Your review</span>
        <textarea className="input min-h-28" maxLength={1000} required value={body} onChange={(e) => setBody(e.target.value)} placeholder="The design, the colour, the artist’s punctuality…" />
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Submit review"}</button>
    </form>
  );
}
