"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { HandIllustration } from "@/components/hand/HandIllustration";
import { HandViewer3D } from "@/components/hand/HandViewer3D";
import { previewArt, previewSide, StudioDesign } from "@/components/studio/types";
import { formatPaise } from "@/lib/money";
import { addDays, formatDuration, formatIstDateString, formatMinutes, istDateString, istWeekday } from "@/lib/time";
import type { Quote } from "@/lib/pricing";
import { allowedSides } from "@/lib/pricing";
import { CustomerLite, IDENTITY_ENABLED, QuickProfile, SignInCard } from "./CheckoutAccount";
import { payForBooking } from "@/lib/one-eighty/pay-booking";

interface RuleLite {
  code: string;
  group_code: string;
  label: string;
  description: string;
  is_default: boolean;
}

interface Policy {
  advancePercent: number;
  holdMinutes: number;
  fullRefundHours: number;
  partialRefundHours: number;
  partialRefundPercent: number;
  bookingWindowDays: number;
}

interface Props {
  design: StudioDesign;
  rules: RuleLite[];
  localities: { id: number; name: string }[];
  policy: Policy;
}

interface Slot {
  start_minute: number;
  available: boolean;
  reason?: string;
}

const STEPS = ["Design", "Service", "When & where", "Checkout"] as const;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Errors = Record<string, string>;

function newIdempotencyKey() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function BookingFlow({ design, rules, localities, policy }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const isFeet = design.region === "feet";
  const sides = allowedSides(design.region);
  const byGroup = (g: string) => rules.filter((r) => r.group_code === g);
  const def = (g: string, allowed?: string[]) => {
    const list = byGroup(g).filter((r) => !allowed || allowed.includes(r.code));
    return (list.find((r) => r.is_default) ?? list[0])?.code ?? "";
  };

  const [hands, setHands] = useState(def("hands"));
  const [side, setSide] = useState(isFeet ? "" : def("side", sides));
  const [coverage, setCoverage] = useState(isFeet ? "" : def("coverage"));
  const [addons, setAddons] = useState<string[]>([]);
  const [people, setPeople] = useState(1);
  const [special, setSpecial] = useState("");

  // Customer account is only needed at checkout (180 Identity sign-in + quick profile).
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [guest, setGuest] = useState(!IDENTITY_ENABLED);
  const [localityId, setLocalityId] = useState<number | "">("");
  const [instructions, setInstructions] = useState("");

  const today = useMemo(() => istDateString(), []);
  const dates = useMemo(() => Array.from({ length: Math.min(policy.bookingWindowDays, 30) }, (_, i) => addDays(today, i)), [today, policy.bookingWindowDays]);
  const [date, setDate] = useState<string>("");
  const [slotState, setSlotState] = useState<{ key: string; slots: Slot[] } | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [chosen, setChosen] = useState<{ key: string; minute: number } | null>(null);

  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [accept, setAccept] = useState(false);
  const [honeypot, setHoneypot] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const idemKey = useRef<string>("");

  useEffect(() => {
    fetch("/api/account")
      .then((r) => r.json())
      .then((j) => {
        if (j.customer) {
          setCustomer(j.customer);
          if (j.customer.locality_id) setLocalityId((cur) => cur || j.customer.locality_id);
        }
      })
      .catch(() => {});
  }, []);
  const top = useRef<HTMLDivElement>(null);

  const options = useMemo(() => ({ hands, side: side || undefined, coverage: coverage || undefined, addons, people }), [hands, side, coverage, addons, people]);
  // Slots and the chosen time are only valid for the exact options, locality and date they were fetched for.
  const slotKey = `${JSON.stringify(options)}|${localityId}|${date}`;
  const slots = slotState?.key === slotKey ? slotState.slots : null;
  const startMinute = chosen?.key === slotKey ? chosen.minute : null;
  const setStartMinute = (m: number | null) => setChosen(m == null ? null : { key: slotKey, minute: m });

  // Server-calculated quote — prices are never computed in the browser.
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ designSlug: design.slug, options, couponCode: appliedCoupon || undefined }),
          signal: ctrl.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not price this selection");
        setQuote(json.quote);
        setQuoteError("");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setQuoteError((e as Error).message);
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [design.slug, options, appliedCoupon]);

  async function loadSlots(d: string) {
    {
      if (!localityId) return;
      const key = `${JSON.stringify(options)}|${localityId}|${d}`;
      setSlotsLoading(true);
      setSlotsError("");
      try {
        const res = await fetch("/api/slots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ designSlug: design.slug, options, localityId, date: d }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not load times");
        setSlotState({ key, slots: json.slots });
      } catch (e) {
        setSlotsError((e as Error).message);
        setSlotState({ key, slots: [] });
      } finally {
        setSlotsLoading(false);
      }
    }
  }

  const goto = (s: number) => {
    setStep(s);
    if (s === 2 && date && slotState?.key !== slotKey) loadSlots(date);
    requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  function validate(s: number): boolean {
    const e: Errors = {};
    if (s === 2) {
      if (!localityId) e.locality = "Choose your locality";
      else if (!date) e.date = "Choose a date";
      else if (startMinute == null) e.slot = "Choose a time";
    }
    if (s === 3 && !accept) e.accept = "Please accept the cancellation and refund policy";
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"], [data-error="true"]')?.focus());
      return false;
    }
    return true;
  }

  const next = () => {
    if (!validate(step)) return;
    goto(Math.min(step + 1, STEPS.length - 1));
  };

  async function submit() {
    if (!validate(3) || !quote || startMinute == null || !localityId || !customer?.profile_complete) return;
    setSubmitting(true);
    setSubmitError("");
    if (!idemKey.current) idemKey.current = newIdempotencyKey();
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idemKey.current },
        body: JSON.stringify({
          designSlug: design.slug,
          options,
          couponCode: appliedCoupon || undefined,
          specialRequirements: special,
          address: {
            line: customer.address_line,
            localityId,
            city: "Hyderabad",
            landmark: customer.landmark ?? "",
            instructions,
          },
          date,
          startMinute,
          acceptPolicy: accept,
          website: honeypot,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === "slot_taken") {
          idemKey.current = "";
          setChosen(null);
          await loadSlots(date);
          goto(2);
          setErrors({ slot: json.error });
        }
        if (json.code === "auth_required") setCustomer(null);
        throw new Error(json.error ?? "Could not create the booking");
      }
      // Open the 180 Pay sheet straight away, still inside the user's click.
      const outcome = await payForBooking(json.token);
      router.push(`/booking/${json.token}?new=1${outcome === "captured" ? "" : "&pay=retry"}`);
    } catch (e) {
      setSubmitError((e as Error).message);
      setSubmitting(false);
    }
  }

  const art = previewArt(design);
  const locName = localities.find((l) => l.id === localityId)?.name;
  const slotLabel = startMinute != null && quote ? `${formatMinutes(startMinute)} – ${formatMinutes(startMinute + quote.duration_minutes)}` : "";

  const Summary = (
    <aside className="card p-5" aria-label="Price summary">
      <div className="flex gap-3">
        <div className="w-16 flex-none rounded-[6px] bg-blush/70">
          <HandIllustration side={previewSide(design)} art={art} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-rose-deep">{design.category_name}</p>
          <p className="font-display text-xl text-plum leading-tight">{design.name}</p>
          {quote && <p className="text-sm text-muted">{formatDuration(quote.duration_minutes)} total</p>}
        </div>
      </div>
      {quote ? (
        <>
          <ul className="mt-4 space-y-1.5 border-t hairline pt-4 text-sm">
            {quote.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-muted">{l.label}</span>
                <span className={l.amount_paise < 0 ? "text-success" : ""}>{l.amount_paise < 0 ? "−" : ""}{formatPaise(Math.abs(l.amount_paise))}</span>
              </li>
            ))}
            {quote.tax_paise === 0 && (
              <li className="flex justify-between gap-3 text-muted">
                <span>Taxes</span>
                <span>Not applicable</span>
              </li>
            )}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t hairline pt-3">
            <span className="font-semibold">Total</span>
            <span className="text-xl font-semibold text-plum">{formatPaise(quote.total_paise)}</span>
          </div>
          <div className="mt-2 rounded-[var(--radius-sm)] bg-blush/70 p-3 text-sm">
            <div className="flex justify-between font-semibold">
              <span>Advance to pay now</span>
              <span>{formatPaise(quote.advance_paise)}</span>
            </div>
            <div className="mt-0.5 flex justify-between text-muted">
              <span>Balance to the artist after the session</span>
              <span>{formatPaise(quote.balance_paise)}</span>
            </div>
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted">{quoteError || "Calculating price…"}</p>
      )}
    </aside>
  );

  const radio = (group: string, value: string, set: (v: string) => void, allowed?: string[]) => (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
      {byGroup(group)
        .filter((r) => !allowed || allowed.includes(r.code))
        .map((r) => (
          <button
            key={r.code}
            type="button"
            role="radio"
            aria-checked={value === r.code}
            onClick={() => set(r.code)}
            className={`min-h-14 rounded-[var(--radius-sm)] border px-4 py-2.5 text-left transition-colors ${
              value === r.code ? "border-plum bg-blush/60 shadow-[0_0_0_1px_var(--color-plum)]" : "hairline bg-white hover:border-rose"
            }`}
          >
            <span className="block font-semibold text-plum-ink">{isFeet && group === "hands" ? r.label.replace("hands", "feet").replace("hand", "foot") : r.label}</span>
            {r.description && <span className="block text-sm text-muted">{r.description}</span>}
          </button>
        ))}
    </div>
  );

  return (
    <div className="container-v py-6 md:py-10" ref={top} style={{ scrollMarginTop: "calc(var(--header-h) + 8px)" }}>
      <Link href={`/designs/${design.slug}`} className="link text-sm">
        Back to design
      </Link>
      <h1 className="mt-2 text-4xl md:text-5xl">Book {design.name}</h1>

      <ol className="mt-5 flex gap-1.5" aria-label="Booking progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button
              type="button"
              disabled={i > step}
              onClick={() => i < step && goto(i)}
              aria-current={i === step ? "step" : undefined}
              className="w-full text-left disabled:cursor-default"
            >
              <span className={`block h-1 rounded-full ${i <= step ? "bg-plum" : "bg-[var(--color-line)]"}`} />
              <span className={`mt-1.5 hidden text-xs sm:block ${i === step ? "font-semibold text-plum" : "text-muted"}`}>{s}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm text-muted sm:hidden">
        Step {step + 1} of {STEPS.length}: <span className="font-semibold text-plum">{STEPS[step]}</span>
      </p>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {step === 0 && (
            <section aria-labelledby="s0">
              <h2 id="s0" className="text-3xl">Your design</h2>
              <div className="arch relative mt-4 h-[52svh] max-h-[520px] overflow-hidden bg-plum">
                <HandViewer3D
                  palmArt={isFeet ? design.assets.feet ?? null : design.assets.palm ?? null}
                  backArt={isFeet ? null : design.assets.back ?? null}
                  region={design.region}
                  designName={design.name}
                  designSlug={design.slug}
                  className="absolute inset-0 pt-6"
                />
              </div>
              <p className="mt-4 text-muted">{design.description}</p>
              <p className="mt-2 text-sm text-muted">
                Base package: one {isFeet ? "pair of feet" : "hand"}, as shown — {formatPaise(design.base_price_paise)}, about {formatDuration(design.duration_minutes)}.
              </p>
            </section>
          )}

          {step === 1 && (
            <section aria-labelledby="s1" className="space-y-7">
              <h2 id="s1" className="text-3xl">Service details</h2>
              <fieldset>
                <legend className="mb-2 font-semibold">{isFeet ? "Feet" : "Hands"}</legend>
                {radio("hands", hands, setHands)}
              </fieldset>
              {!isFeet && sides.length > 1 && (
                <fieldset>
                  <legend className="mb-2 font-semibold">Side</legend>
                  {radio("side", side, setSide, sides)}
                </fieldset>
              )}
              {!isFeet && (
                <fieldset>
                  <legend className="mb-2 font-semibold">Coverage</legend>
                  {radio("coverage", coverage, setCoverage)}
                </fieldset>
              )}
              <fieldset>
                <legend className="mb-2 font-semibold">Add-ons</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {byGroup("addon")
                    .filter((r) => !(isFeet && r.code === "addon_feet"))
                    .map((r) => {
                      const on = addons.includes(r.code);
                      return (
                        <button
                          key={r.code}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => setAddons((a) => (on ? a.filter((x) => x !== r.code) : [...a, r.code]))}
                          className={`min-h-14 rounded-[var(--radius-sm)] border px-4 py-2.5 text-left ${on ? "border-plum bg-blush/60 shadow-[0_0_0_1px_var(--color-plum)]" : "hairline bg-white hover:border-rose"}`}
                        >
                          <span className="block font-semibold">{r.label}</span>
                          {r.description && <span className="block text-sm text-muted">{r.description}</span>}
                        </button>
                      );
                    })}
                </div>
              </fieldset>
              <div className="field max-w-xs">
                <label htmlFor="people">Number of people</label>
                <div className="flex items-center gap-2">
                  <button type="button" className="btn btn-secondary w-12 px-0" onClick={() => setPeople((p) => Math.max(1, p - 1))} aria-label="Fewer people">−</button>
                  <input id="people" className="input text-center" inputMode="numeric" value={people} onChange={(e) => setPeople(Math.min(20, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)))} />
                  <button type="button" className="btn btn-secondary w-12 px-0" onClick={() => setPeople((p) => Math.min(20, p + 1))} aria-label="More people">+</button>
                </div>
                <p className="field-hint">Including you. Each extra person gets the same design and options.</p>
              </div>
              <div className="field">
                <label htmlFor="special">Special requirements (optional)</label>
                <textarea id="special" className="input min-h-24" maxLength={500} value={special} onChange={(e) => setSpecial(e.target.value)} placeholder="Allergies, preferred henna cone, design changes…" />
              </div>
            </section>
          )}

          {step === 2 && (
            <section aria-labelledby="s3">
              <h2 id="s3" className="text-3xl">When and where</h2>
              <div className="field mt-4 max-w-sm">
                <label htmlFor="locality">Your locality in Hyderabad</label>
                <select
                  id="locality"
                  className="input"
                  value={localityId}
                  onChange={(e) => {
                    setLocalityId(e.target.value ? Number(e.target.value) : "");
                    setChosen(null);
                    setSlotState(null);
                  }}
                  aria-invalid={!!errors.locality}
                >
                  <option value="">Choose locality</option>
                  {localities.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                {errors.locality ? <p className="field-error">{errors.locality}</p> : <p className="field-hint">Don’t see yours? <Link href="/contact" className="link">Ask us</Link>.</p>}
              </div>
              <p className="mt-1 text-sm text-muted">
                All times are India Standard Time. {quote && <>Your session takes about {formatDuration(quote.duration_minutes)}.</>} {locName && <>Showing artists who serve {locName}.</>}
              </p>
              <div className="scroller -mx-4 mt-4 px-4 pb-1 sm:mx-0 sm:px-0" role="radiogroup" aria-label="Date" data-error={!!errors.date} tabIndex={errors.date ? -1 : undefined}>
                {dates.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={date === d}
                    onClick={() => {
                      setDate(d);
                      setChosen(null);
                      if (localityId) loadSlots(d);
                    }}
                    className={`flex h-[72px] w-[60px] flex-col items-center justify-center rounded-[var(--radius-sm)] border ${date === d ? "border-plum bg-plum text-ivory" : "hairline bg-white"}`}
                    aria-label={formatIstDateString(d, true)}
                  >
                    <span className="text-xs">{WEEKDAY[istWeekday(d)]}</span>
                    <span className="text-xl font-semibold">{Number(d.slice(8))}</span>
                    <span className="text-[0.65rem] opacity-80">{formatIstDateString(d).split(" ").slice(-1)[0]}</span>
                  </button>
                ))}
              </div>
              {errors.date && <p className="field-error mt-2">{errors.date}</p>}

              <div className="mt-6" aria-live="polite">
                {!localityId ? (
                  <p className="text-muted">Choose your locality to see artists near you.</p>
                ) : !date ? (
                  <p className="text-muted">Pick a date to see available times.</p>
                ) : slotsLoading ? (
                  <p className="text-muted" role="status">Checking artist availability…</p>
                ) : slotsError ? (
                  <p className="field-error">{slotsError}</p>
                ) : slots && slots.some((s) => s.available) ? (
                  <>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Start time" data-error={!!errors.slot} tabIndex={errors.slot ? -1 : undefined}>
                      {slots
                        .filter((s) => s.reason !== "past")
                        .map((s) => (
                          <button
                            key={s.start_minute}
                            type="button"
                            role="radio"
                            aria-checked={startMinute === s.start_minute}
                            disabled={!s.available}
                            onClick={() => setStartMinute(s.start_minute)}
                            className={`h-12 rounded-[var(--radius-sm)] border text-sm font-semibold disabled:cursor-not-allowed disabled:border-transparent disabled:bg-blush/40 disabled:text-muted disabled:line-through ${
                              startMinute === s.start_minute ? "border-plum bg-plum text-ivory" : "hairline bg-white"
                            }`}
                          >
                            {formatMinutes(s.start_minute)}
                          </button>
                        ))}
                    </div>
                    <p className="mt-2 text-xs text-muted">Crossed-out times are already booked or outside artist hours.</p>
                  </>
                ) : (
                  <div className="card p-5">
                    <p className="font-semibold">No artist is available on this date for your area.</p>
                    <p className="mt-1 text-sm text-muted">Try another date, or <Link href="/contact" className="link">contact us</Link> and we’ll try to arrange one.</p>
                  </div>
                )}
                {errors.slot && <p className="field-error mt-2">{errors.slot}</p>}
              </div>
            </section>
          )}

          {step === 3 && quote && !customer && (
            <section aria-labelledby="s4a" className="space-y-4">
              <h2 id="s4a" className="text-3xl">Checkout</h2>
              {guest ? (
                <QuickProfile
                  guest
                  customer={{ id: "", name: "", phone: null, email: null, gender: null, address_line: null, locality_id: null, landmark: null, profile_complete: false }}
                  localities={localities}
                  defaultLocalityId={localityId}
                  onSaved={(c) => setCustomer(c)}
                />
              ) : (
                <SignInCard onSignedIn={(c) => setCustomer(c)} onGuest={() => setGuest(true)} />
              )}
            </section>
          )}
          {step === 3 && quote && customer && !customer.profile_complete && (
            <section aria-labelledby="s4b" className="space-y-4">
              <h2 id="s4b" className="text-3xl">Checkout</h2>
              <QuickProfile customer={customer} localities={localities} defaultLocalityId={localityId} onSaved={(c) => setCustomer(c)} />
            </section>
          )}
          {step === 3 && quote && customer?.profile_complete && (
            <section aria-labelledby="s4" className="space-y-5">
              <h2 id="s4" className="text-3xl">Review and pay</h2>
              <dl className="card divide-y divide-[var(--color-line)]">
                {[
                  ["Design", design.name],
                  ["Package", quote.lines[0].label.split(" — ")[1] + (quote.options.people > 1 ? `, ${quote.options.people} people` : "")],
                  ["Artist", "Assigned from artists available in your area. You’ll see their name once they confirm."],
                  ["Date and time", `${formatIstDateString(date, true)}, ${slotLabel} IST`],
                  ["Address", `${customer.address_line}, ${locName}, Hyderabad${customer.landmark ? ` (near ${customer.landmark})` : ""}`],
                  ["Contact", `${customer.name}, ${customer.phone ?? ""}`],
                ].map(([k, v]) => (
                  <div key={k} className="grid gap-1 p-4 sm:grid-cols-[140px_1fr]">
                    <dt className="text-sm text-muted">{k}</dt>
                    <dd className="text-sm">{v}</dd>
                  </div>
                ))}
              </dl>

              {customer.locality_id !== localityId && (
                <p className="rounded-[var(--radius-sm)] bg-gold/15 p-3 text-sm">
                  Your saved address is in {localities.find((l) => l.id === customer.locality_id)?.name ?? "another locality"}, but you picked times for {locName}.{" "}
                  <button type="button" className="link" onClick={() => setCustomer({ ...customer, profile_complete: false })}>Update address</button> or{" "}
                  <button type="button" className="link" onClick={() => goto(2)}>change locality</button>.
                </p>
              )}
              <div className="field">
                <label htmlFor="instructions">Instructions for the artist (optional)</label>
                <input id="instructions" className="input" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Gate number, parking, floor" />
              </div>
              <div className="hidden" aria-hidden>
                <label htmlFor="website">Website</label>
                <input id="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
              </div>
              <p className="text-xs text-muted">
                Signed in as {customer.email ?? customer.phone}.{" "}
                <button type="button" className="link" onClick={() => setCustomer({ ...customer, profile_complete: false })}>Edit details</button>
              </p>
              <div className="field max-w-sm">
                <label htmlFor="coupon">Discount code</label>
                <div className="flex gap-2">
                  <input id="coupon" className="input uppercase" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} maxLength={30} />
                  <button type="button" className="btn btn-secondary" onClick={() => setAppliedCoupon(coupon.trim())} disabled={!coupon.trim()}>
                    Apply
                  </button>
                </div>
                {quote.coupon && <p className={quote.coupon.applied ? "text-sm text-success" : "field-error"}>{quote.coupon.message}</p>}
              </div>

              <div className="rounded-[var(--radius-md)] border hairline bg-blush/40 p-4 text-sm">
                <h3 className="font-sans text-base font-semibold text-plum-ink">Cancellation and refund policy</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                  <li>You pay an advance of {policy.advancePercent}% now; the balance is paid to the artist after the session.</li>
                  <li>Cancel {policy.fullRefundHours}+ hours before the start time for a full refund of the advance.</li>
                  <li>Cancel {policy.partialRefundHours}–{policy.fullRefundHours} hours before for a {policy.partialRefundPercent}% refund of the advance.</li>
                  <li>Cancellations within {policy.partialRefundHours} hours are not refundable.</li>
                  <li>If we cannot confirm an artist, you receive a full refund.</li>
                  <li>Unpaid bookings are released after {policy.holdMinutes} minutes.</li>
                </ul>
                <Link href="/cancellation-refund" className="link mt-2 inline-block" target="_blank">
                  Read the full policy
                </Link>
                <label className="mt-3 flex items-start gap-3">
                  <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--color-plum)]" checked={accept} onChange={(e) => setAccept(e.target.checked)} aria-invalid={!!errors.accept} />
                  <span>I have read and accept the cancellation and refund policy and the <Link href="/terms" className="link" target="_blank">terms</Link>.</span>
                </label>
                {errors.accept && <p className="field-error mt-1">{errors.accept}</p>}
              </div>
              {submitError && <p className="field-error" role="alert">{submitError}</p>}
            </section>
          )}

          <div className="sticky bottom-0 z-20 -mx-4 mt-8 flex items-center gap-3 border-t hairline bg-ivory/95 px-4 py-3 backdrop-blur-md sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            {step > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => goto(step - 1)}>
                Back
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              {quote && <span className="text-sm font-semibold text-plum lg:hidden">{formatPaise(quote.total_paise)}</span>}
              {step < 3 ? (
                <button type="button" className="btn btn-primary" onClick={next} disabled={!quote}>
                  Continue
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting || !quote || !customer?.profile_complete || customer.locality_id !== localityId}>
                  {submitting ? "Opening secure payment…" : `Pay ${quote ? formatPaise(quote.advance_paise) : ""} advance`}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="hidden lg:block">
          <div className="sticky" style={{ top: "calc(var(--header-h) + 16px)" }}>
            {Summary}
          </div>
        </div>
        <details className="lg:hidden card p-0 order-first">
          <summary className="flex cursor-pointer items-center justify-between p-4 text-sm font-semibold">
            <span>Price summary</span>
            <span className="text-plum">{quote ? formatPaise(quote.total_paise) : "…"}</span>
          </summary>
          <div className="border-t hairline">{Summary}</div>
        </details>
      </div>
    </div>
  );
}
